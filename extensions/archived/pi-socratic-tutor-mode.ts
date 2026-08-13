/**
 * Pi Socratic Tutor Mode Extension
 *
 * Toggle a Socratic tutor mode via /socratic-tutor.
 *
 * Usage:
 *   pi -e ./extensions/pi-socratic-tutor-mode.ts
 *   /socratic-tutor
 *   /socratic-tutor on
 *   /socratic-tutor off
 *   /socratic-tutor status
 *   /socratic-tutor Help me reason through this concept
 *
 * Optional startup flags (after extension is loaded):
 *   --socratic-tutor
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const DEFAULT_PI_SOCRATIC_TUTOR_PROMPT = `You are an expert Socratic tutor.
Your goal is to help me learn by guiding me through questions and reflection.
You will ask targeted, incremental questions that help me discover answers myself.
When I share confusion, you should identify assumptions, probe understanding, and adapt question difficulty.
You can offer brief hints, but prioritize question-led learning over direct answers unless I explicitly ask for one.
Focus on building understanding, reasoning, and metacognition through dialogue.
Do not write code unless I explicitly ask you to.`;

interface SocraticTutorModeState {
	enabled: boolean;
	prompt: string;
	promptSource: string;
	socraticTutorPath: string | undefined;
}

function parseSocraticTutorModeEntry(
	entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>,
): boolean | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== "socratic-tutor-mode") {
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

function getSocraticTutorPathFromSettings(value: unknown): string | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const settings = value as Record<string, unknown>;
	const raw =
		typeof settings.socratic_tutor_path === "string"
			? settings.socratic_tutor_path
			: typeof settings.socraticTutorPath === "string"
				? settings.socraticTutorPath
				: undefined;
	if (!raw) {
		return undefined;
	}

	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function resolveSocraticTutorPathFromPiSettings(cwd: string): string | undefined {
	const projectSettingsPath = join(cwd, ".pi", "settings.json");
	const globalSettingsPath = join(homedir(), ".pi", "agent", "settings.json");

	const projectPath = getSocraticTutorPathFromSettings(readJsonFile(projectSettingsPath));
	if (projectPath) {
		return projectPath;
	}

	return getSocraticTutorPathFromSettings(readJsonFile(globalSettingsPath));
}

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
	if (!ctx.hasUI) {
		return;
	}
	ctx.ui.setStatus("socratic-tutor-mode", enabled ? ctx.ui.theme.fg("accent", "socratic-tutor") : undefined);
}

export default function piSocraticTutorModeExtension(pi: ExtensionAPI): void {
	const state: SocraticTutorModeState = {
		enabled: false,
		prompt: DEFAULT_PI_SOCRATIC_TUTOR_PROMPT,
		promptSource: "embedded",
		socraticTutorPath: undefined,
	};

	pi.registerFlag("socratic-tutor", {
		description: "Start in pi socratic tutor mode",
		type: "boolean",
		default: false,
	});

	const persistState = (): void => {
		pi.appendEntry("socratic-tutor-mode", { enabled: state.enabled });
	};

	const refreshSocraticTutorPath = (cwd: string): void => {
		state.socraticTutorPath = resolveSocraticTutorPathFromPiSettings(cwd);
	};

	const clearSocraticTutorPath = (): void => {
		state.socraticTutorPath = undefined;
	};

	pi.registerCommand("socratic-tutor", {
		description: "Toggle pi socratic tutor mode (or use: /socratic-tutor on|off|status)",
		handler: async (args, ctx) => {
			const normalized = args.trim().toLowerCase();

			if (normalized === "status") {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`socratic tutor mode ${state.enabled ? "enabled" : "disabled"}. Prompt: ${state.promptSource}`,
					);
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
				refreshSocraticTutorPath(ctx.cwd);
			} else if (!state.enabled && wasEnabled) {
				clearSocraticTutorPath();
			}

			persistState();
			updateStatus(ctx, state.enabled);
			if (ctx.hasUI) {
				ctx.ui.notify(
					state.enabled ? `socratic tutor mode enabled (${state.promptSource})` : "socratic tutor mode disabled",
					"info",
				);
			}

			if (forwardedText) {
				pi.sendUserMessage(forwardedText);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("socratic-tutor") === true) {
			state.enabled = true;
		}

		const persistedEnabled = parseSocraticTutorModeEntry(ctx.sessionManager.getEntries());
		if (persistedEnabled !== undefined) {
			state.enabled = persistedEnabled;
		}

		if (state.enabled) {
			refreshSocraticTutorPath(ctx.cwd);
		} else {
			clearSocraticTutorPath();
		}

		updateStatus(ctx, state.enabled);
	});

	pi.on("before_agent_start", async (event) => {
		if (!state.enabled) {
			return undefined;
		}

		const socraticTutorPathContext = state.socraticTutorPath
			? `\n\nMy socratic tutor notes are stored in ${state.socraticTutorPath}. Read ${join(state.socraticTutorPath, "AGENTS.md")}.`
			: "";
		const systemPrompt = `${event.systemPrompt}\n\n${state.prompt}${socraticTutorPathContext}`;
		return { systemPrompt };
	});
}
