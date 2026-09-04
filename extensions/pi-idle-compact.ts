import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type CompactionMode,
	getGlobalSettingsPath,
	getProjectSettingsPath,
	normalizeMode,
	readJsonObject,
	resolveCompactionSettings,
	resolveConfiguredMode,
} from "./pi-compaction-modes.ts";

// Warm-cache auto compact on idle.
//
// After the agent settles (or a session starts / the tree is navigated), an idle
// timer is armed. If no user input or agent activity happens for `idleSeconds`
// (default 240s — under Anthropic's 5-minute prompt-cache TTL even with clock
// skew), a compaction is triggered while the prompt cache is still warm: the
// summary turn (dance modes) or the built-in summarizer reuses the cached
// prefix instead of reprocessing it, and every later turn runs on the smaller
// compacted context. `/tree` back to any entry before the compaction if you
// don't need it.
//
// Depends on pi-compaction-modes.ts: imports its mode list, mode selection, and
// settings helpers, and passes the mode to ctx.compact() the same way
// `/compact <mode>` does (as custom instructions, which pi-compaction-modes
// parses back into a mode).
//
// Settings section "pi-idle-compact" (project .pi/settings.json, then
// ~/.pi/agent/settings.json):
//
//   {
//     "pi-idle-compact": {
//       "enabled": true,      // default: true
//       "idleSeconds": 240,   // integer seconds, default: 240
//       "mode": "cached"      // optional; default: the mode configured in pi-compaction-modes
//     }
//   }

const SETTINGS_SECTION = "pi-idle-compact";
const DEFAULT_IDLE_SECONDS = 240;

// Compaction outcomes that are expected for an idle trigger and must not be
// surfaced as errors.
const EXPECTED_COMPACT_ERRORS = [
	// Dance modes cancel the initial compact and complete via the summary turn.
	"Compaction cancelled",
	// pi refuses when the leaf is already a compaction entry or nothing past
	// the keep window is left to summarize.
	"Already compacted",
	"Nothing to compact",
	"No model selected",
];

type IdleCompactSettings = {
	enabled: boolean;
	idleSeconds: number;
	mode: CompactionMode | undefined;
};

function readIdleCompactSection(filePath: string): Record<string, unknown> | undefined {
	const settings = readJsonObject(filePath);
	const section = settings?.[SETTINGS_SECTION];
	if (!section || typeof section !== "object" || Array.isArray(section)) return;
	return section as Record<string, unknown>;
}

function parseIdleSeconds(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return;
	return value;
}

function resolveIdleCompactSettings(cwd: string): IdleCompactSettings {
	const project = readIdleCompactSection(getProjectSettingsPath(cwd));
	const global = readIdleCompactSection(getGlobalSettingsPath());
	return {
		enabled: project?.enabled ?? global?.enabled ?? true,
		idleSeconds:
			parseIdleSeconds(project?.idleSeconds) ?? parseIdleSeconds(global?.idleSeconds) ?? DEFAULT_IDLE_SECONDS,
		mode: normalizeMode(project?.mode) ?? normalizeMode(global?.mode),
	};
}

function isExpectedCompactionError(message: string): boolean {
	return EXPECTED_COMPACT_ERRORS.some((expected) => message.includes(expected));
}

function fireIdleCompact(ctx: ExtensionContext, idleSeconds: number): void {
	const settings = resolveIdleCompactSettings(ctx.cwd);
	if (!settings.enabled) return;
	if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

	// Skip when usage is unknown (e.g. right after a compaction) or when there
	// is nothing past the keep window to summarize (pi would refuse to compact).
	const usage = ctx.getContextUsage();
	if (usage?.tokens == null) return;
	const { keepRecentTokens } = resolveCompactionSettings(ctx.cwd);
	if (usage.tokens <= keepRecentTokens) return;

	// The leaf is already a compaction entry; nothing new to compact.
	if (ctx.sessionManager.getLeafEntry()?.type === "compaction") return;

	const mode = settings.mode ?? resolveConfiguredMode(ctx.cwd);
	if (ctx.hasUI) {
		ctx.ui.notify(
			`Idle for ${idleSeconds}s — compacting while the prompt cache is warm (mode: ${mode}). /tree back if you don't need it.`,
			"info",
		);
	}
	ctx.compact({
		customInstructions: mode,
		onComplete: () => {
			if (ctx.hasUI) ctx.ui.notify(`Idle compaction complete (mode: ${mode}).`, "info");
		},
		onError: (error) => {
			if (isExpectedCompactionError(error.message)) return;
			if (ctx.hasUI) ctx.ui.notify(`Idle compaction failed: ${error.message}`, "warning");
		},
	});
}

export default function (pi: ExtensionAPI) {
	let idleTimer: ReturnType<typeof setTimeout> | undefined;

	function disarm(): void {
		if (idleTimer === undefined) return;
		clearTimeout(idleTimer);
		idleTimer = undefined;
	}

	function arm(ctx: ExtensionContext): void {
		disarm();
		const settings = resolveIdleCompactSettings(ctx.cwd);
		if (!settings.enabled) return;
		idleTimer = setTimeout(() => {
			idleTimer = undefined;
			try {
				fireIdleCompact(ctx, settings.idleSeconds);
			} catch {
				// The runner went away (session replaced/shutdown) before the timer fired.
			}
		}, settings.idleSeconds * 1000);
		idleTimer.unref?.();
	}

	// The agent fully settled: no streaming, retry, compaction, or queued
	// continuation will run. Start the idle clock.
	pi.on("agent_settled", (_event, ctx) => arm(ctx));

	// User activity: a new run starts or real input arrives. Extension-sourced
	// input is the compaction dance summary turn and must not reset the clock.
	pi.on("agent_start", () => disarm());
	pi.on("input", (event) => {
		if (event.source === "interactive" || event.source === "rpc") disarm();
	});

	pi.on("session_start", (_event, ctx) => arm(ctx));
	pi.on("session_tree", (_event, ctx) => arm(ctx));
	pi.on("session_shutdown", () => disarm());
}
