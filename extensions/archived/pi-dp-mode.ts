/**
 * Pi Deliberate Practice Coach Extension
 *
 * Toggle a deliberate practice coach mode via /dp.
 *
 * Usage:
 *   pi -e ./extensions/pi-dp-mode.ts
 *   /dp
 *   /dp on
 *   /dp off
 *   /dp status
 *   /dp Help me design a deliberate practice session for this skill
 *
 * Optional startup flags (after extension is loaded):
 *   --dp
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const DEFAULT_PI_DP_PROMPT = `You are an expert deliberate practice coach.
Your goal is to help me improve skills through focused, high-quality deliberate practice.
You will help me define target skills, break them into sub-skills, and design short practice drills.
When I share goals or performance issues, you should identify bottlenecks, propose feedback loops, and calibrate challenge level.
You can ask me questions to clarify constraints, evaluate outcomes, and adapt the next practice block.
Focus on specificity, repetition with feedback, and measurable progress over time.
Do not write code unless I explicitly ask you to.`;

interface DpModeState {
	enabled: boolean;
	prompt: string;
	promptSource: string;
	dpPath: string | undefined;
}

function parseDpModeEntry(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>): boolean | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== "dp-mode") {
			continue;
		}

		const data = entry.data;
		if (!data || typeof data !== "object") {
			return undefined;
		}
		const enabled = (data as { enabled?: unknown }).enabled;
		if (typeof enabled === "boolean") {
			return enabled;
		}
		return undefined;
	}

	return undefined;
}

function readJsonFile(path: string): unknown | undefined {
	if (!existsSync(path)) {
		return undefined;
	}

	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return undefined;
	}
}

function getDpPathFromSettings(value: unknown): string | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const settings = value as Record<string, unknown>;
	const raw =
		typeof settings.dp_path === "string"
			? settings.dp_path
			: typeof settings.dpPath === "string"
				? settings.dpPath
				: undefined;
	if (!raw) {
		return undefined;
	}

	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function resolveDpPathFromPiSettings(cwd: string): string | undefined {
	const projectSettingsPath = join(cwd, ".pi", "settings.json");
	const globalSettingsPath = join(homedir(), ".pi", "agent", "settings.json");

	const projectPath = getDpPathFromSettings(readJsonFile(projectSettingsPath));
	if (projectPath) {
		return projectPath;
	}

	return getDpPathFromSettings(readJsonFile(globalSettingsPath));
}

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
	if (!ctx.hasUI) {
		return;
	}
	ctx.ui.setStatus("dp-mode", enabled ? ctx.ui.theme.fg("accent", "dp") : undefined);
}

export default function piDpModeExtension(pi: ExtensionAPI): void {
	const state: DpModeState = {
		enabled: false,
		prompt: DEFAULT_PI_DP_PROMPT,
		promptSource: "embedded",
		dpPath: undefined,
	};

	pi.registerFlag("dp", {
		description: "Start in pi deliberate practice coach mode",
		type: "boolean",
		default: false,
	});

	const persistState = (): void => {
		pi.appendEntry("dp-mode", { enabled: state.enabled });
	};

	const refreshDpPath = (cwd: string): void => {
		state.dpPath = resolveDpPathFromPiSettings(cwd);
	};

	const clearDpPath = (): void => {
		state.dpPath = undefined;
	};

	pi.registerCommand("dp", {
		description: "Toggle pi deliberate practice coach mode (or use: /dp on|off|status)",
		handler: async (args, ctx) => {
			const normalized = args.trim().toLowerCase();

			if (normalized === "status") {
				if (ctx.hasUI) {
					ctx.ui.notify(`dp mode ${state.enabled ? "enabled" : "disabled"}. Prompt: ${state.promptSource}`);
				}
				updateStatus(ctx, state.enabled);
				return;
			}

			const wasEnabled = state.enabled;
			let forwardedText: string | undefined;

			if (normalized === "on" || normalized === "enable" || normalized === "enabled") {
				state.enabled = true;
			} else if (normalized === "off" || normalized === "disable" || normalized === "disabled") {
				state.enabled = false;
			} else if (normalized.length > 0) {
				state.enabled = true;
				forwardedText = args.trim();
			} else {
				state.enabled = !state.enabled;
			}

			if (state.enabled && !wasEnabled) {
				refreshDpPath(ctx.cwd);
			} else if (!state.enabled && wasEnabled) {
				clearDpPath();
			}

			persistState();
			updateStatus(ctx, state.enabled);
			if (ctx.hasUI) {
				ctx.ui.notify(state.enabled ? `dp mode enabled (${state.promptSource})` : "dp mode disabled", "info");
			}

			if (forwardedText) {
				pi.sendUserMessage(forwardedText);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("dp") === true) {
			state.enabled = true;
		}

		const persistedEnabled = parseDpModeEntry(ctx.sessionManager.getEntries());
		if (persistedEnabled !== undefined) {
			state.enabled = persistedEnabled;
		}

		if (state.enabled) {
			refreshDpPath(ctx.cwd);
		} else {
			clearDpPath();
		}

		updateStatus(ctx, state.enabled);
	});

	pi.on("before_agent_start", async (event) => {
		if (!state.enabled) {
			return undefined;
		}

		const dpPathContext = state.dpPath
			? `\n\nMy deliberate practice notes are stored in ${state.dpPath}. Read ${join(state.dpPath, "AGENTS.md")}.`
			: "";
		const systemPrompt = `${event.systemPrompt}\n\n${state.prompt}${dpPathContext}`;
		return { systemPrompt };
	});
}
