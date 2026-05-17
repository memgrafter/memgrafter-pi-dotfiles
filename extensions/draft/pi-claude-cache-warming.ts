/**
 * Pi Claude Cache Warming Extension
 *
 * Keeps Anthropic OAuth session context warm by issuing out-of-band keepalive calls
 * after idle periods. This is intended for Claude subscription users where prompt
 * cache expires after idle periods.
 *
 * Two modes:
 *   5m - Pro plan (~5 minute cache expiry): warms after 4m45s idle, min 5min interval
 *   1h - Max plan (~1 hour cache expiry): warms after 58.5min idle, min 59min interval
 *
 * Global defaults in settings.json (read-only, not settable via /cachewarm):
 *   "cachewarm": {
 *     "enabled": true,          // default: false
 *     "mode": "5m",             // default: "1h" ("5m"=="pro", "1h"=="max")
 *     "maxConsecutive": 1       // default: 1 (0=disabled, -1=unlimited)
 *   }
 *
 * Usage:
 *   /cachewarm         - toggle on/off (session)
 *   /cachewarm on      - enable (session)
 *   /cachewarm off     - disable (session)
 *   /cachewarm 5m|pro  - set to 5-minute mode (session)
 *   /cachewarm 1h|max  - set to 1-hour mode (session)
 *   /cachewarm status  - show current state
 *   /cachewarm now     - warm immediately
 *
 * Optional startup flags (after extension is loaded):
 *   --cachewarm
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { completeSimple, type Context as AiContext, type Message as AiMessage, type Usage } from "@mariozechner/pi-ai";
import { buildSessionContext, convertToLlm, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";

const CHECK_INTERVAL_MS = 15 * 1000;
const DEFAULT_MAX_CONSECUTIVE = 1;
const KEEPALIVE_PROMPT =
	"Cache keepalive ping. Respond with exactly one token: ok";

interface GlobalConfig {
	maxConsecutive: number;
	enabled: boolean;
	mode: WarmMode;
}

function loadGlobalConfig(): GlobalConfig {
	const defaults: GlobalConfig = {
		maxConsecutive: DEFAULT_MAX_CONSECUTIVE,
		enabled: false,
		mode: "1h",
	};
	try {
		const globalPath = join(homedir(), ".pi", "agent", "settings.json");
		const projectPath = join(process.cwd(), ".pi", "settings.json");

		// Project settings override global (same as pi settings merge order)
		for (const path of [globalPath, projectPath]) {
			if (!existsSync(path)) continue;
			const raw = JSON.parse(readFileSync(path, "utf-8"));
			const cw = raw?.cachewarm;
			if (!cw || typeof cw !== "object") continue;
			if (typeof cw.enabled === "boolean") defaults.enabled = cw.enabled;
			if (cw.mode === "5m" || cw.mode === "1h") defaults.mode = cw.mode;
			if (typeof cw.maxConsecutive === "number" && cw.maxConsecutive >= -1) defaults.maxConsecutive = cw.maxConsecutive;
		}
	} catch {}
	return defaults;
}

type WarmMode = "5m" | "1h";

interface WarmProfile {
	idleBeforeWarm: number;
	minWarmInterval: number;
}

const WARM_PROFILES: Record<WarmMode, WarmProfile> = {
	"5m": {
		idleBeforeWarm: 4 * 60 * 1000 + 45 * 1000, // 4m45s
		minWarmInterval: 5 * 60 * 1000, // 5 minutes
	},
	"1h": {
		idleBeforeWarm: 58 * 60 * 1000 + 30 * 1000, // 58.5 minutes
		minWarmInterval: 59 * 60 * 1000, // 59 minutes
	},
};

interface CacheWarmState {
	enabled: boolean;
	mode: WarmMode;
	warming: boolean;
	lastActivityAt: number;
	lastWarmAt: number | undefined;
	lastAttemptAt: number | undefined;
	lastError: string | undefined;
	successCount: number;
	failureCount: number;
	consecutiveCount: number;
	lastUsage: Usage | undefined;
}

function parsePersistedState(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>): {
	enabled?: boolean;
	mode?: WarmMode;
} {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== "claude-cache-warming") {
			continue;
		}

		const data = entry.data;
		if (!data || typeof data !== "object") {
			return {};
		}

		const result: { enabled?: boolean; mode?: WarmMode } = {};
		const enabled = (data as { enabled?: unknown }).enabled;
		if (typeof enabled === "boolean") {
			result.enabled = enabled;
		}

		const mode = (data as { mode?: unknown }).mode;
		if (mode === "5m" || mode === "1h") {
			result.mode = mode;
		}

		return result;
	}

	return {};
}

function formatDuration(ms: number): string {
	if (ms < 1000) return "0s";
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds}s`;
	return `${minutes}m ${seconds}s`;
}

function updateStatus(ctx: ExtensionContext, state: CacheWarmState): void {
	if (!ctx.hasUI) {
		return;
	}

	if (!state.enabled) {
		ctx.ui.setStatus("claude-cache-warming", undefined);
		return;
	}

	let label = "cachewarm";
	if (state.warming) {
		label += " warming";
	} else {
		label += ` (int:${state.mode}, last:${state.lastWarmAt ? formatDuration(Date.now() - state.lastWarmAt) + " ago" : "never"})`;
	}
	ctx.ui.setStatus("claude-cache-warming", ctx.ui.theme.fg("accent", label));
}

function getActiveToolsForContext(pi: ExtensionAPI): AiContext["tools"] {
	const activeToolNames = new Set(pi.getActiveTools());
	const allTools = pi.getAllTools();
	const tools = allTools
		.filter((tool) => activeToolNames.has(tool.name))
		.map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		}));

	return tools.length > 0 ? tools : undefined;
}

function getEligibility(ctx: ExtensionContext): { eligible: boolean; reason: string } {
	const model = ctx.model;
	if (!model) {
		return { eligible: false, reason: "No active model" };
	}
	if (model.provider !== "anthropic") {
		return { eligible: false, reason: `Active provider is ${model.provider}, not anthropic` };
	}
	if (!ctx.modelRegistry.isUsingOAuth(model)) {
		return {
			eligible: false,
			reason: "Anthropic model is using API key auth; use PI_CACHE_RETENTION=long instead",
		};
	}
	return { eligible: true, reason: "eligible" };
}

function buildStatusLine(ctx: ExtensionContext, state: CacheWarmState): string {
	const eligibility = getEligibility(ctx);
	const model = ctx.model;
	const modelText = model ? `${model.provider}/${model.id}` : "none";
	const profile = WARM_PROFILES[state.mode];
	const idleFor = formatDuration(Date.now() - state.lastActivityAt);
	const lastWarm = state.lastWarmAt ? formatDuration(Date.now() - state.lastWarmAt) + " ago" : "never";
	const cacheRead = state.lastUsage?.cacheRead ?? 0;
	const cacheWrite = state.lastUsage?.cacheWrite ?? 0;

	return [
		`cache warming: ${state.enabled ? "enabled" : "disabled"}`,
		`mode: ${state.mode} (idle=${formatDuration(profile.idleBeforeWarm)}, interval=${formatDuration(profile.minWarmInterval)})`,
		`model: ${modelText}`,
		`eligibility: ${eligibility.eligible ? "yes" : `no (${eligibility.reason})`}`,
		`idle for: ${idleFor}`,
		`last warm: ${lastWarm}`,
		`last usage: cacheRead=${cacheRead}, cacheWrite=${cacheWrite}`,
		`consecutive: ${state.consecutiveCount}/${globalConfig.maxConsecutive < 0 ? "∞" : globalConfig.maxConsecutive}`,
		`stats: ok=${state.successCount}, failed=${state.failureCount}`,
		state.lastError ? `last error: ${state.lastError}` : "",
	]
		.filter((line) => line.length > 0)
		.join("\n");
}

export default function piClaudeCacheWarmingExtension(pi: ExtensionAPI): void {
	const globalConfig = loadGlobalConfig();

	const state: CacheWarmState = {
		enabled: false,
		mode: "1h",
		warming: false,
		lastActivityAt: Date.now(),
		lastWarmAt: undefined,
		lastAttemptAt: undefined,
		lastError: undefined,
		successCount: 0,
		failureCount: 0,
		consecutiveCount: 0,
		lastUsage: undefined,
	};

	let intervalId: ReturnType<typeof setInterval> | null = null;
	let runtimeCtx: ExtensionContext | null = null;

	const persistState = (): void => {
		pi.appendEntry("claude-cache-warming", { enabled: state.enabled, mode: state.mode });
	};

	const markActivity = (ctx: ExtensionContext): void => {
		state.lastActivityAt = Date.now();
		state.consecutiveCount = 0;
		updateStatus(ctx, state);
	};

	const stopScheduler = (): void => {
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
	};

	const warmNow = async (ctx: ExtensionContext, manual: boolean): Promise<void> => {
		if (state.warming) {
			if (manual && ctx.hasUI) {
				ctx.ui.notify("Cache warm already running", "warning");
			}
			return;
		}

		const eligibility = getEligibility(ctx);
		if (!eligibility.eligible) {
			if (manual && ctx.hasUI) {
				ctx.ui.notify(eligibility.reason, "warning");
			}
			return;
		}

		if ((!ctx.isIdle() || ctx.hasPendingMessages()) && !manual) {
			return;
		}

		const model = ctx.model;
		if (!model) {
			return;
		}

		state.warming = true;
		state.lastAttemptAt = Date.now();
		updateStatus(ctx, state);

		try {
			const apiKey = await ctx.modelRegistry.getApiKey(model);
			if (!apiKey) {
				throw new Error(`No credential available for ${model.provider}`);
			}

			const sessionContext = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
			const messages: AiMessage[] = [
				...convertToLlm(sessionContext.messages),
				{
					role: "user",
					content: KEEPALIVE_PROMPT,
					timestamp: Date.now(),
				},
			];

			const requestContext: AiContext = {
				systemPrompt: ctx.getSystemPrompt(),
				messages,
				tools: getActiveToolsForContext(pi),
			};

			const response = await completeSimple(model, requestContext, {
				apiKey,
				temperature: 0,
				maxTokens: 8,
				cacheRetention: "short",
				sessionId: ctx.sessionManager.getSessionId(),
			});

			state.lastWarmAt = Date.now();
			state.lastError = undefined;
			state.lastUsage = response.usage;
			state.successCount += 1;
			if (!manual) {
				state.consecutiveCount += 1;
			}

			// Log to session (visible in chat, not sent to LLM)
			pi.sendMessage({
				customType: "claude-cache-warming-log",
				content: `cache warm ok (mode:${state.mode}, cacheRead:${response.usage.cacheRead}, cacheWrite:${response.usage.cacheWrite}${manual ? ", manual" : ""})`,
				display: true,
			});

			if (manual && ctx.hasUI) {
				ctx.ui.notify(
					`Cache warm complete (cacheRead=${response.usage.cacheRead}, cacheWrite=${response.usage.cacheWrite})`,
					"info",
				);
			}
		} catch (error) {
			state.failureCount += 1;
			state.lastError = error instanceof Error ? error.message : String(error);

			// Log failure to session (visible in chat, not sent to LLM)
			pi.sendMessage({
				customType: "claude-cache-warming-log",
				content: `cache warm failed (mode:${state.mode}, error:${state.lastError}${manual ? ", manual" : ""})`,
				display: true,
			});

			if (manual && ctx.hasUI) {
				ctx.ui.notify(`Cache warm failed: ${state.lastError}`, "error");
			}
		} finally {
			state.warming = false;
			updateStatus(ctx, state);
		}
	};

	const maybeWarm = async (): Promise<void> => {
		const ctx = runtimeCtx;
		if (!ctx) {
			return;
		}

		// Always refresh the status text so the "ago" time stays current
		updateStatus(ctx, state);

		if (!state.enabled || state.warming) {
			return;
		}
		if (globalConfig.maxConsecutive >= 0 && state.consecutiveCount >= globalConfig.maxConsecutive) {
			return;
		}
		if (!ctx.isIdle() || ctx.hasPendingMessages()) {
			return;
		}

		const profile = WARM_PROFILES[state.mode];
		const now = Date.now();
		if (now - state.lastActivityAt < profile.idleBeforeWarm) {
			return;
		}
		if (state.lastWarmAt && now - state.lastWarmAt < profile.minWarmInterval) {
			return;
		}

		await warmNow(ctx, false);
	};

	const startScheduler = (ctx: ExtensionContext): void => {
		runtimeCtx = ctx;
		stopScheduler();
		intervalId = setInterval(() => {
			void maybeWarm();
		}, CHECK_INTERVAL_MS);
	};

	pi.registerFlag("cachewarm", {
		description: "Enable Claude OAuth cache warming",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("cachewarm", {
		description: "Toggle Claude OAuth cache warming (on|off|5m==pro|1h==max|status|now)",
		handler: async (args, ctx) => {
			const normalized = args.trim().toLowerCase();

			if (normalized === "status") {
				if (ctx.hasUI) {
					ctx.ui.notify(buildStatusLine(ctx, state), "info");
				}
				updateStatus(ctx, state);
				return;
			}

			if (normalized === "now") {
				await warmNow(ctx, true);
				return;
			}

			const modeAlias: Record<string, WarmMode> = { "5m": "5m", "pro": "5m", "1h": "1h", "max": "1h" };
			if (normalized in modeAlias) {
				state.mode = modeAlias[normalized];
				persistState();
				markActivity(ctx);
				updateStatus(ctx, state);
				if (ctx.hasUI) {
					const profile = WARM_PROFILES[state.mode];
					ctx.ui.notify(
						`mode set to ${state.mode} (idle=${formatDuration(profile.idleBeforeWarm)}, interval=${formatDuration(profile.minWarmInterval)})`,
						"info",
					);
				}
				return;
			}

			if (normalized === "on" || normalized === "enable" || normalized === "enabled") {
				state.enabled = true;
			} else if (normalized === "off" || normalized === "disable" || normalized === "disabled") {
				state.enabled = false;
			} else if (normalized.length === 0 || normalized === "toggle") {
				state.enabled = !state.enabled;
			} else {
				if (ctx.hasUI) {
					ctx.ui.notify("Usage: /cachewarm [on|off|5m==pro|1h==max|status|now]", "warning");
				}
				return;
			}

			persistState();
			markActivity(ctx);
			updateStatus(ctx, state);

			if (ctx.hasUI) {
				ctx.ui.notify(`cache warming ${state.enabled ? "enabled" : "disabled"}`, "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		// Priority: session persisted > --cachewarm flag > global default
		state.enabled = globalConfig.enabled;
		state.mode = globalConfig.mode;

		if (pi.getFlag("cachewarm") === true) {
			state.enabled = true;
		}

		const persisted = parsePersistedState(ctx.sessionManager.getEntries());
		if (persisted.enabled !== undefined) {
			state.enabled = persisted.enabled;
		}
		if (persisted.mode !== undefined) {
			state.mode = persisted.mode;
		}

		state.lastActivityAt = Date.now();
		updateStatus(ctx, state);
		startScheduler(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		// Priority: session persisted > global default
		state.enabled = globalConfig.enabled;
		state.mode = globalConfig.mode;

		const persisted = parsePersistedState(ctx.sessionManager.getEntries());
		if (persisted.enabled !== undefined) {
			state.enabled = persisted.enabled;
		}
		if (persisted.mode !== undefined) {
			state.mode = persisted.mode;
		}
		state.lastActivityAt = Date.now();
		updateStatus(ctx, state);
		startScheduler(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		markActivity(ctx);
	});

	pi.on("input", async (event, ctx) => {
		if (event.source !== "extension") {
			markActivity(ctx);
		}
		return { action: "continue" };
	});

	pi.on("message_start", async (event, ctx) => {
		if (event.message.role === "assistant") {
			state.lastWarmAt = Date.now();
			updateStatus(ctx, state);
		}
	});

	pi.on("tool_call", async (_event, ctx) => {
		state.lastWarmAt = Date.now();
		updateStatus(ctx, state);
	});

	pi.on("agent_end", async (_event, ctx) => {
		markActivity(ctx);
	});

	pi.events.on("redraw", () => {
		if (runtimeCtx) {
			updateStatus(runtimeCtx, state);
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		stopScheduler();
		runtimeCtx = null;
		if (ctx.hasUI) {
			ctx.ui.setStatus("claude-cache-warming", undefined);
		}
	});
}
