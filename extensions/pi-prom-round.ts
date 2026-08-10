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
 * end. Failed or aborted turns still produce events: the runtime emits a
 * synthetic assistant message with stopReason "error" | "aborted" and zero usage
 * (EMPTY_USAGE), so broken turns are folded in with an error stop reason and no
 * token cost.
 *
 * Captured per round (all real provider/runtime data, no estimates):
 * - usage/cost sums, per-turn usage + latency, tool calls (count + per-tool
 *   breakdown with errors and durations), stop reason, error message
 * - model (start) + unique models list (model_select / per-message)
 * - thinking level (round start, updated on thinking_level_select)
 * - compaction usage folded into the active round; standalone compaction and
 *   branch-summary model calls emitted as their own records (kind field)
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

interface ToolStats {
	calls: number;
	errors: number;
	durationMs: number;
}

type RoundKind = "round" | "compaction" | "branch_summary";

interface RoundState {
	kind: RoundKind;
	active: boolean;
	/** Number of agent_start cycles observed in this round (retries included). */
	runs: number;
	startMs: number;
	endMs: number;
	provider: string;
	model: string;
	models: string[];
	thinkingLevel: string;
	stopReason: string;
	errorMessage?: string;
	turnCount: number;
	turns: Array<{ latencyMs: number; usage: UsageLike }>;
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
	tools: Record<string, ToolStats>;
	/** turnIndex -> start timestamp, toolCallId -> start timestamp */
	turnStartTimes: Map<number, number>;
	toolStartTimes: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0 });

const emptyCost = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });

function freshRound(kind: RoundKind = "round"): RoundState {
	return {
		kind,
		active: false,
		runs: 0,
		startMs: 0,
		endMs: 0,
		provider: "",
		model: "",
		models: [],
		thinkingLevel: "",
		stopReason: "unknown",
		turnCount: 0,
		turns: [],
		usage: emptyUsage(),
		cost: emptyCost(),
		toolCalls: 0,
		tools: {},
		turnStartTimes: new Map(),
		toolStartTimes: new Map(),
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

function pushModel(round: RoundState, model: string | undefined): void {
	if (!model) return;
	if (!round.model) round.model = model;
	if (!round.models.includes(model)) round.models.push(model);
}

function metricsDir(): string {
	return join(getAgentDir(), "metrics");
}

/** Append one record. Never throws out of event handlers. */
function appendRecord(round: RoundState, sessionId: string, sessionFile: string | undefined, cwd: string): void {
	try {
		const line = JSON.stringify({
			kind: round.kind,
			ts: round.endMs,
			sessionId,
			sessionFile: sessionFile ? sessionFile.split("/").pop() : undefined,
			cwd,
			provider: round.provider,
			model: round.model,
			models: round.models,
			thinkingLevel: round.thinkingLevel || undefined,
			durationMs: round.endMs - round.startMs,
			runs: round.runs,
			turnCount: round.turnCount,
			turns: round.turns.length > 0 ? round.turns : undefined,
			toolCalls: round.toolCalls,
			tools: Object.keys(round.tools).length > 0 ? round.tools : undefined,
			stopReason: round.stopReason,
			errorMessage: round.errorMessage ?? null,
			usage: round.usage,
			cost: round.cost,
		});
		mkdirSync(metricsDir(), { recursive: true });
		appendFileSync(join(metricsDir(), "rounds.jsonl"), line + "\n", "utf8");
	} catch (error) {
		console.error("[pi-prom-round] rounds.jsonl append failed:", error);
	}
}

/** Standalone model-call record (compaction / branch summary outside a round). */
function recordStandalone(
	kind: Exclude<RoundKind, "round">,
	usage: UsageLike | undefined,
	ctx: ExtensionContext,
	stopReason: string,
): void {
	if (!usage) return;
	const round = freshRound(kind);
	round.active = true;
	round.startMs = Date.now();
	round.endMs = round.startMs;
	round.stopReason = stopReason;
	const model = ctx.model;
	round.provider = model?.provider ?? "";
	round.model = model?.id ?? "";
	pushModel(round, model?.id);
	addUsage(round.usage, usage);
	addCost(round.cost, usage.cost);
	appendRecord(round, ctx.sessionManager.getSessionId(), ctx.sessionManager.getSessionFile(), ctx.cwd ?? process.cwd());
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
	let round = freshRound();

	pi.on("agent_start", (_event, ctx) => {
		try {
			if (!round.active) {
				round = freshRound("round");
				round.active = true;
				round.startMs = Date.now();
				const model = ctx.model;
				round.provider = model?.provider ?? "";
				pushModel(round, model?.id);
				round.thinkingLevel = ctx.thinkingLevel ?? "";
			}
			round.runs++;
		} catch (error) {
			console.error("[pi-prom-round] agent_start failed:", error);
		}
	});

	pi.on("turn_start", (event, _ctx) => {
		try {
			if (round.active) round.turnStartTimes.set(event.turnIndex, event.timestamp);
		} catch (error) {
			console.error("[pi-prom-round] turn_start failed:", error);
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

			round.turnCount++;
			const start = round.turnStartTimes.get(event.turnIndex);
			round.turns.push({
				latencyMs: start !== undefined ? Date.now() - start : 0,
				usage: assistant.usage ?? emptyUsage(),
			});
			round.turnStartTimes.delete(event.turnIndex);

			if (assistant.stopReason) round.stopReason = assistant.stopReason;
			if (assistant.errorMessage) round.errorMessage = assistant.errorMessage;
			pushModel(round, assistant.model);
		} catch (error) {
			console.error("[pi-prom-round] turn_end failed:", error);
		}
	});

	pi.on("tool_execution_start", (event, _ctx) => {
		try {
			if (round.active) round.toolStartTimes.set(event.toolCallId, Date.now());
		} catch (error) {
			console.error("[pi-prom-round] tool_execution_start failed:", error);
		}
	});

	pi.on("tool_execution_end", (event, _ctx) => {
		try {
			if (!round.active) return;
			const stats = (round.tools[event.toolName] ??= { calls: 0, errors: 0, durationMs: 0 });
			stats.calls++;
			if (event.isError) stats.errors++;
			const start = round.toolStartTimes.get(event.toolCallId);
			if (start !== undefined) {
				stats.durationMs += Date.now() - start;
				round.toolStartTimes.delete(event.toolCallId);
			}
		} catch (error) {
			console.error("[pi-prom-round] tool_execution_end failed:", error);
		}
	});

	pi.on("model_select", (event, _ctx) => {
		try {
			if (round.active) pushModel(round, event.model?.id);
		} catch (error) {
			console.error("[pi-prom-round] model_select failed:", error);
		}
	});

	pi.on("thinking_level_select", (event, _ctx) => {
		try {
			if (round.active) round.thinkingLevel = event.level;
		} catch (error) {
			console.error("[pi-prom-round] thinking_level_select failed:", error);
		}
	});

	pi.on("session_compact", (event, ctx) => {
		try {
			const usage = event.compactionEntry?.usage;
			if (round.active) {
				addUsage(round.usage, usage);
				addCost(round.cost, usage?.cost);
			} else {
				recordStandalone("compaction", usage, ctx, "compaction");
			}
		} catch (error) {
			console.error("[pi-prom-round] session_compact failed:", error);
		}
	});

	pi.on("session_tree", (event, ctx) => {
		try {
			if (event.summaryEntry?.usage) {
				if (round.active) {
					addUsage(round.usage, event.summaryEntry.usage);
					addCost(round.cost, event.summaryEntry.usage.cost);
				} else {
					recordStandalone("branch_summary", event.summaryEntry.usage, ctx, "branch_summary");
				}
			}
		} catch (error) {
			console.error("[pi-prom-round] session_tree failed:", error);
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
		appendRecord(round, ctx.sessionManager.getSessionId(), ctx.sessionManager.getSessionFile(), ctx.cwd ?? process.cwd());
		round = freshRound();
	}
}
