/**
 * Pi CBT Mode Extension
 *
 * Toggle a Cognitive Behavioral Therapy mode via /cbt.
 *
 * Usage:
 *   pi -e ./extensions/pi-cbt-mode.ts
 *   /cbt
 *   /cbt on
 *   /cbt off
 *   /cbt status
 *   /cbt I had this thought today and want to work through it
 *
 * Optional startup flags (after extension is loaded):
 *   --cbt
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const DEFAULT_PI_CBT_PROMPT = `You are an expert in Cognitive Behavioral Therapy (CBT).
Your goal is to help me with my mental well-being by using CBT techniques.
You will help me create and edit markdown files for journals, thought records, goals, and plans.
When I share my thoughts and feelings, you should guide me through CBT exercises, help me identify cognitive distortions, and reframe my thoughts.
You can ask me questions to help me reflect and gain insights.
Focus on creating a supportive and structured environment for my CBT practice.
Do not write code unless I explicitly ask you to.`;

interface CbtModeState {
	enabled: boolean;
	prompt: string;
	promptSource: string;
	cbtPath: string | undefined;
}

function parseCbtModeEntry(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>): boolean | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== "cbt-mode") {
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

function getCbtPathFromSettings(value: unknown): string | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const settings = value as Record<string, unknown>;
	const raw =
		typeof settings.cbt_path === "string"
			? settings.cbt_path
			: typeof settings.cbtPath === "string"
				? settings.cbtPath
				: undefined;
	if (!raw) {
		return undefined;
	}

	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function resolveCbtPathFromPiSettings(cwd: string): string | undefined {
	const projectSettingsPath = join(cwd, ".pi", "settings.json");
	const globalSettingsPath = join(homedir(), ".pi", "agent", "settings.json");

	const projectPath = getCbtPathFromSettings(readJsonFile(projectSettingsPath));
	if (projectPath) {
		return projectPath;
	}

	return getCbtPathFromSettings(readJsonFile(globalSettingsPath));
}

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
	if (!ctx.hasUI) {
		return;
	}
	ctx.ui.setStatus("cbt-mode", enabled ? ctx.ui.theme.fg("accent", "cbt") : undefined);
}

export default function piCbtModeExtension(pi: ExtensionAPI): void {
	const state: CbtModeState = {
		enabled: false,
		prompt: DEFAULT_PI_CBT_PROMPT,
		promptSource: "embedded",
		cbtPath: undefined,
	};

	pi.registerFlag("cbt", {
		description: "Start in pi cbt mode",
		type: "boolean",
		default: false,
	});

	const persistState = (): void => {
		pi.appendEntry("cbt-mode", { enabled: state.enabled });
	};

	const refreshCbtPath = (cwd: string): void => {
		state.cbtPath = resolveCbtPathFromPiSettings(cwd);
	};

	const clearCbtPath = (): void => {
		state.cbtPath = undefined;
	};

	pi.registerCommand("cbt", {
		description: "Toggle pi cbt mode (or use: /cbt on|off|status)",
		handler: async (args, ctx) => {
			const normalized = args.trim().toLowerCase();

			if (normalized === "status") {
				if (ctx.hasUI) {
					ctx.ui.notify(`cbt mode ${state.enabled ? "enabled" : "disabled"}. Prompt: ${state.promptSource}`);
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
				refreshCbtPath(ctx.cwd);
			} else if (!state.enabled && wasEnabled) {
				clearCbtPath();
			}

			persistState();
			updateStatus(ctx, state.enabled);
			if (ctx.hasUI) {
				ctx.ui.notify(state.enabled ? `cbt mode enabled (${state.promptSource})` : "cbt mode disabled", "info");
			}

			if (forwardedText) {
				pi.sendUserMessage(forwardedText);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("cbt") === true) {
			state.enabled = true;
		}

		const persistedEnabled = parseCbtModeEntry(ctx.sessionManager.getEntries());
		if (persistedEnabled !== undefined) {
			state.enabled = persistedEnabled;
		}

		if (state.enabled) {
			refreshCbtPath(ctx.cwd);
		} else {
			clearCbtPath();
		}

		updateStatus(ctx, state.enabled);
	});

	pi.on("before_agent_start", async (event) => {
		if (!state.enabled) {
			return undefined;
		}

		const cbtPathContext = state.cbtPath
			? `\n\nMy cbt notes are stored in ${state.cbtPath}. Read ${join(state.cbtPath, "AGENTS.md")}.`
			: "";
		const systemPrompt = `${event.systemPrompt}\n\n${state.prompt}${cbtPathContext}`;
		return { systemPrompt };
	});
}
