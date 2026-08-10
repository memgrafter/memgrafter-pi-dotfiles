/**
 * pi-prom-round — per-round metrics, append-only.
 *
 * Emits one JSON record per completed agent round (user prompt -> agent
 * settled) by appending to ~/.pi/agent/metrics/rounds.jsonl. That log is the
 * single source of truth; per-session views and Prometheus ingestion are
 * projections done elsewhere (filter by sessionId, or read the session file).
 *
 * Round model: a "round" is the interval between agent_settled events. One user
 * prompt can span multiple agent_start/agent_end cycles (auto-retry, compaction
 * continuation, queued follow-up messages); agent_settled fires once at the true
 * end. Failed or user-aborted turns still produce events: the runtime emits a
 * synthetic assistant message with stopReason "error" | "aborted" and zero usage
 * (EMPTY_USAGE), so broken turns are folded in with an error stop reason and no
 * token cost.
 *
 * Design notes and open questions: see pi-prom-round.WIP.md.
 */

import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types (structural — avoids depending on pi's internal message type exports)
// ---------------------------------------------------------------------------

interface UsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	reasoning?: number;
	totalTokens?: number;
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		total?: number;
	};
}

interface AssistantMessageLike {
	role?: string;
	usage?: UsageLike;
	stopReason?: string;
	errorMessage?: string;
	model?: string;
	provider?: string;
}

interface RoundState {
	active: boolean;
	/** Number of agent_start cycles observed in this round (retries included). */
	runs: number;
	startMs: number;
	endMs: number;
	provider: string;
	model: string;
	stopReason: string;
	errorMessage?: string;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		reasoning: number;
		totalTokens: number;
	};
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	toolCalls: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshRound(): RoundState {
	return {
		active: false,
		runs: 0,
		startMs: 0,
		endMs: 0,
		provider: "",
		model: "",
		stopReason: "unknown",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0 },
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		toolCalls: 0,
	};
}

function asAssistant(message: unknown): AssistantMessageLike | undefined {
	if (!message || typeof message !== "object") return undefined;
	const candidate = message as AssistantMessageLike;
	return candidate.role === "assistant" ? candidate : undefined;
}

function addUsage(target: RoundState["usage"], usage: UsageLike | undefined): void {
	if (!usage) return;
	target.input += usage.input ?? 0;
	target.output += usage.output ?? 0;
	target.cacheRead += usage.cacheRead ?? 0;
	target.cacheWrite += usage.cacheWrite ?? 0;
	target.reasoning += usage.reasoning ?? 0;
	target.totalTokens += usage.totalTokens ?? 0;
}

function addCost(target: RoundState["cost"], cost: UsageLike["cost"] | undefined): void {
	if (!cost) return;
	target.input += cost.input ?? 0;
	target.output += cost.output ?? 0;
	target.cacheRead += cost.cacheRead ?? 0;
	target.cacheWrite += cost.cacheWrite ?? 0;
	target.total += cost.total ?? 0;
}

function metricsDir(): string {
	return join(getAgentDir(), "metrics");
}

/** Append one round record. Never throws out of event handlers. */
function appendRound(record: RoundState, sessionId: string, sessionFile: string | undefined, cwd: string): void {
	try {
		const line = JSON.stringify({
			ts: record.endMs,
			sessionId,
			sessionFile: sessionFile ? sessionFile.split("/").pop() : undefined,
			cwd,
			provider: record.provider,
			model: record.model,
			durationMs: record.endMs - record.startMs,
			runs: record.runs,
			toolCalls: record.toolCalls,
			stopReason: record.stopReason,
			errorMessage: record.errorMessage ?? null,
			usage: record.usage,
			cost: record.cost,
		});
		mkdirSync(metricsDir(), { recursive: true });
		appendFileSync(join(metricsDir(), "rounds.jsonl"), line + "\n", "utf8");
	} catch (error) {
		console.error("[pi-prom-round] rounds.jsonl append failed:", error);
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
	let round = freshRound();

	pi.on("agent_start", (_event, ctx) => {
		try {
			if (!round.active) {
				round = freshRound();
				round.active = true;
				round.startMs = Date.now();
				const model = ctx.model;
				round.provider = model?.provider ?? "";
				round.model = model?.id ?? "";
			}
			round.runs++;
		} catch (error) {
			console.error("[pi-prom-round] agent_start failed:", error);
		}
	});

	pi.on("turn_end", (event, _ctx) => {
		try {
			if (!round.active) return;
			const assistant = asAssistant(event.message);
			if (!assistant) return;

			addUsage(round.usage, assistant.usage);
			addCost(round.cost, assistant.usage?.cost);
			round.toolCalls += Array.isArray(event.toolResults) ? event.toolResults.length : 0;

			if (assistant.stopReason) round.stopReason = assistant.stopReason;
			if (assistant.errorMessage) round.errorMessage = assistant.errorMessage;
			if (assistant.model && !round.model) round.model = assistant.model;
			if (assistant.provider && !round.provider) round.provider = assistant.provider;
		} catch (error) {
			console.error("[pi-prom-round] turn_end failed:", error);
		}
	});

	pi.on("agent_settled", (_event, ctx) => {
		try {
			if (!round.active) return;
			round.endMs = Date.now();
			finishRound(ctx);
		} catch (error) {
			console.error("[pi-prom-round] agent_settled failed:", error);
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		try {
			if (!round.active) return;
			round.endMs = Date.now();
			round.stopReason = round.stopReason === "unknown" ? "interrupted" : round.stopReason;
			finishRound(ctx);
		} catch (error) {
			console.error("[pi-prom-round] session_shutdown failed:", error);
		}
	});

	function finishRound(ctx: ExtensionContext): void {
		const sessionId = ctx.sessionManager.getSessionId();
		const sessionFile = ctx.sessionManager.getSessionFile();
		const cwd = ctx.cwd ?? process.cwd();

		appendRound(round, sessionId, sessionFile, cwd);

		round = freshRound();
	}
}
