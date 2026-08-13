/**
 * Pi PKM Mode Extension
 *
 * Toggle a Personal Knowledge Management mode via /pkm.
 *
 * Usage:
 *   pi -e ./extensions/pi-pkm-mode.ts
 *   /pkm
 *   /pkm on
 *   /pkm off
 *   /pkm status
 *   /pkm Capture this idea in my notes
 *
 * Optional startup flags (after extension is loaded):
 *   --pkm
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const DEFAULT_PI_PKM_PROMPT = `You are an expert personal knowledge manager.
Your goal is to help me organize my thoughts, ideas, and knowledge into a structured set of files.
You will be creating and editing markdown files.
When I share ideas with you, you should help me clarify them and then save them to the appropriate files.
You can ask me questions to better understand where to save the information or how to structure it.
Focus on creating a well-organized and easy-to-navigate knowledge base.
Do not write code unless I explicitly ask you to.`;

interface PkmModeState {
	enabled: boolean;
	prompt: string;
	promptSource: string;
	pkmPath: string | undefined;
}

function parsePkmModeEntry(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>): boolean | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== "pkm-mode") {
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

function getPkmPathFromSettings(value: unknown): string | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const settings = value as Record<string, unknown>;
	const raw =
		typeof settings.pkm_path === "string"
			? settings.pkm_path
			: typeof settings.pkmPath === "string"
				? settings.pkmPath
				: undefined;
	if (!raw) {
		return undefined;
	}

	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function resolvePkmPathFromPiSettings(cwd: string): string | undefined {
	const projectSettingsPath = join(cwd, ".pi", "settings.json");
	const globalSettingsPath = join(homedir(), ".pi", "agent", "settings.json");

	const projectPath = getPkmPathFromSettings(readJsonFile(projectSettingsPath));
	if (projectPath) {
		return projectPath;
	}

	return getPkmPathFromSettings(readJsonFile(globalSettingsPath));
}

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
	if (!ctx.hasUI) {
		return;
	}
	ctx.ui.setStatus("pkm-mode", enabled ? ctx.ui.theme.fg("accent", "pkm") : undefined);
}

export default function piPkmModeExtension(pi: ExtensionAPI): void {
	const state: PkmModeState = {
		enabled: false,
		prompt: DEFAULT_PI_PKM_PROMPT,
		promptSource: "embedded",
		pkmPath: undefined,
	};

	pi.registerFlag("pkm", {
		description: "Start in pi pkm mode",
		type: "boolean",
		default: false,
	});

	const persistState = (): void => {
		pi.appendEntry("pkm-mode", { enabled: state.enabled });
	};

	const refreshPkmPath = (cwd: string): void => {
		state.pkmPath = resolvePkmPathFromPiSettings(cwd);
	};

	const clearPkmPath = (): void => {
		state.pkmPath = undefined;
	};

	pi.registerCommand("pkm", {
		description: "Toggle pi pkm mode (or use: /pkm on|off|status)",
		handler: async (args, ctx) => {
			const normalized = args.trim().toLowerCase();

			if (normalized === "status") {
				if (ctx.hasUI) {
					ctx.ui.notify(`pkm mode ${state.enabled ? "enabled" : "disabled"}. Prompt: ${state.promptSource}`);
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
				refreshPkmPath(ctx.cwd);
			} else if (!state.enabled && wasEnabled) {
				clearPkmPath();
			}

			persistState();
			updateStatus(ctx, state.enabled);
			if (ctx.hasUI) {
				ctx.ui.notify(state.enabled ? `pkm mode enabled (${state.promptSource})` : "pkm mode disabled", "info");
			}

			if (forwardedText) {
				pi.sendUserMessage(forwardedText);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("pkm") === true) {
			state.enabled = true;
		}

		const persistedEnabled = parsePkmModeEntry(ctx.sessionManager.getEntries());
		if (persistedEnabled !== undefined) {
			state.enabled = persistedEnabled;
		}

		if (state.enabled) {
			refreshPkmPath(ctx.cwd);
		} else {
			clearPkmPath();
		}

		updateStatus(ctx, state.enabled);
	});

	pi.on("before_agent_start", async (event) => {
		if (!state.enabled) {
			return undefined;
		}

		const pkmPathContext = state.pkmPath
			? `\n\nMy pkm is stored in ${state.pkmPath}. Read ${join(state.pkmPath, "AGENTS.md")}.`
			: "";
		const systemPrompt = `${event.systemPrompt}\n\n${state.prompt}${pkmPathContext}`;
		return { systemPrompt };
	});
}
