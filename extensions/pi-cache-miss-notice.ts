/**
 * pi-cache-miss-notice.ts
 *
 * Persist prompt-cache misses to the session so they survive resume/compaction
 * and show up in `~/.pi/agent/sessions/*.jsonl`.
 *
 * pi's built-in cache-miss notice is drawn as ephemeral UI at message_end and
 * never written to the session. This extension reimplements a lean version of
 * that detection, appends a `custom` session entry (customType
 * "cache-miss-notice") via pi.appendEntry(), and registers an entry renderer
 * so the notice still displays in chat on reload.
 *
 * Optional gate in ~/.pi/agent/settings.json:
 *   { "cache-miss-notice": { "enabled": false } }
 * (default: enabled)
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	CustomEntry,
	ExtensionAPI,
	ExtensionContext,
	MessageEndEvent,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const ENTRY_TYPE = "cache-miss-notice";

/** Anthropic default cache TTL (5 min). Idle gaps past this explain a miss. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Per-turn misses at or below this are cache-breakpoint noise. */
const NOISE_FLOOR = 1024;
/** Only persist misses at or above this significance. */
const MIN_TOKENS = 20_000;
const MIN_COST = 0.1;

interface NoticeData {
	label: string;
	missedTokens: number;
	missedCost: number;
	idleMs: number;
	modelChanged: boolean;
	model: string;
}

function promptTokens(usage: AgentMessage["usage"] | undefined): number {
	if (!usage) return 0;
	return usage.input + usage.cacheRead + usage.cacheWrite;
}

function readEnabled(): boolean {
	try {
		const path = join(homedir(), ".pi", "agent", "settings.json");
		if (!existsSync(path)) return true;
		const settings = JSON.parse(readFileSync(path, "utf-8")) as {
			"cache-miss-notice"?: { enabled?: boolean };
		};
		return settings["cache-miss-notice"]?.enabled ?? true;
	} catch {
		return true;
	}
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return `${n}`;
}

interface LastRequest {
	promptTokens: number;
	timestamp: number;
	modelKey: string;
	/** Sticky: any prior request in this segment reported cache activity. */
	reportedCache: boolean;
}

/**
 * Last request (assistant message) that could have populated the cache.
 * `reportedCache` is sticky across the segment (like pi's cache-stats): a full
 * miss on a provider that does report caching is a real miss, while a provider
 * that never reports cache activity means nothing.
 */
function lastRequest(entries: SessionEntry[]): LastRequest | undefined {
	let result: LastRequest | undefined;
	let reportedCache = false;
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type === "compaction" || e.type === "branch_summary") break; // context reset
		if (e.type !== "message") continue;
		const msg = (e as { message: AgentMessage }).message;
		if (msg.role !== "assistant") continue;
		const usage = msg.usage;
		const pt = promptTokens(usage);
		if (usage && usage.cacheRead + usage.cacheWrite > 0) reportedCache = true;
		if (pt <= 0) continue;
		if (!result) {
			result = {
				promptTokens: pt,
				timestamp: msg.timestamp,
				modelKey: `${msg.provider}/${msg.model}`,
				reportedCache: false,
			};
		}
	}
	if (!result) return undefined;
	result.reportedCache = reportedCache;
	return result;
}

function detectMiss(
	message: AgentMessage,
	prev: ReturnType<typeof lastRequest>,
): NoticeData | undefined {
	if (message.stopReason === "aborted" || message.stopReason === "error") return undefined;
	const usage = message.usage;
	const prompt = promptTokens(usage);
	if (!prev || prompt <= 0 || (usage.cacheRead + usage.cacheWrite === 0 && !prev.reportedCache)) return undefined;

	const missedTokens = Math.min(prev.promptTokens, prompt) - usage.cacheRead;
	if (missedTokens <= NOISE_FLOOR) return undefined;

	// Extra cost = missed tokens billed at paid rate instead of cache-read rate.
	const paidTokens = usage.input + usage.cacheWrite;
	const paidPerToken = paidTokens > 0 ? (usage.cost.input + usage.cost.cacheWrite) / paidTokens : 0;
	const readPerToken = usage.cacheRead > 0 ? usage.cost.cacheRead / usage.cacheRead : 0;
	const missedCost = missedTokens * Math.max(0, paidPerToken - readPerToken);

	if (missedTokens < MIN_TOKENS && missedCost < MIN_COST) return undefined;

	const idleMs = Math.max(0, message.timestamp - prev.timestamp);
	const modelChanged = `${message.provider}/${message.model}` !== prev.modelKey;

	let label = "Cache miss";
	if (modelChanged) label = "Cache miss after model switch";
	else if (idleMs >= CACHE_TTL_MS) label = `Cache miss after ${Math.round(idleMs / 60_000)}m idle`;

	return {
		label,
		missedTokens,
		missedCost,
		idleMs,
		modelChanged,
		model: `${message.provider}/${message.model}`,
	};
}

export default function (pi: ExtensionAPI): void {
	pi.registerEntryRenderer(ENTRY_TYPE, (entry, _options, theme) => {
		const d = entry.data as NoticeData | undefined;
		if (!d) return undefined;
		const cost = d.missedCost >= 0.01 ? ` (~$${d.missedCost.toFixed(2)})` : "";
		const text = `${d.label}: ${formatTokens(d.missedTokens)} tokens re-billed${cost}`;
		return new Text(theme.fg("warning", text), 1, 0);
	});

	pi.on("message_end", (event: MessageEndEvent, ctx: ExtensionContext) => {
		if (!readEnabled()) return;
		const message = event.message;
		if (message.role !== "assistant" || !message.usage) return;

		const prev = lastRequest(ctx.sessionManager.getEntries());
		const miss = detectMiss(message, prev);
		if (miss) pi.appendEntry(ENTRY_TYPE, miss);
	});
}
