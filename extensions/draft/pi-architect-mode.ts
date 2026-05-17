/**
 * Pi Architect Mode Extension
 *
 * Toggle a software architect mode via /architect.
 *
 * Usage:
 *   pi -e ./extensions/pi-architect-mode.ts
 *   /architect
 *   /architect on
 *   /architect off
 *   /architect status
 *   /architect Design a migration plan for this feature
 *
 * Optional startup flags (after extension is loaded):
 *   --architect
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// Prompt text below is adapted from Aider's architect prompt:
// https://github.com/Aider-AI/aider/blob/main/aider/coders/architect_prompts.py
// Aider is licensed under Apache-2.0.
const DEFAULT_PI_ARCHITECT_PROMPT = `Act as an expert software architect engineer and provide direction to your editor engineer.
Study the change request and the current code.
Describe how to modify the code to complete the request.
The editor engineer will rely solely on your instructions, so make them unambiguous and complete.
Explain all needed code changes clearly and completely, but concisely.
Just show the changes needed.
DO NOT show the entire updated function/file/etc.
Do not directly implement code unless I explicitly ask you to.
If you need any missing file contents or repository context, ask me for it explicitly.`;

interface ArchitectModeState {
	enabled: boolean;
	prompt: string;
	promptSource: string;
}

function parseArchitectModeEntry(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>): boolean | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== "architect-mode") {
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

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
	if (!ctx.hasUI) {
		return;
	}
	ctx.ui.setStatus("architect-mode", enabled ? ctx.ui.theme.fg("accent", "architect") : undefined);
}

export default function piArchitectModeExtension(pi: ExtensionAPI): void {
	const state: ArchitectModeState = {
		enabled: false,
		prompt: DEFAULT_PI_ARCHITECT_PROMPT,
		promptSource: "embedded",
	};

	pi.registerFlag("architect", {
		description: "Start in pi architect mode",
		type: "boolean",
		default: false,
	});

	const persistState = (): void => {
		pi.appendEntry("architect-mode", { enabled: state.enabled });
	};

	pi.registerCommand("architect", {
		description: "Toggle pi architect mode (or use: /architect on|off|status)",
		handler: async (args, ctx) => {
			const normalized = args.trim().toLowerCase();

			if (normalized === "status") {
				if (ctx.hasUI) {
					ctx.ui.notify(`architect mode ${state.enabled ? "enabled" : "disabled"}. Prompt: ${state.promptSource}`);
				}
				updateStatus(ctx, state.enabled);
				return;
			}

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

			persistState();
			updateStatus(ctx, state.enabled);
			if (ctx.hasUI) {
				ctx.ui.notify(state.enabled ? `architect mode enabled (${state.promptSource})` : "architect mode disabled", "info");
			}

			if (forwardedText) {
				pi.sendUserMessage(forwardedText);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("architect") === true) {
			state.enabled = true;
		}

		const persistedEnabled = parseArchitectModeEntry(ctx.sessionManager.getEntries());
		if (persistedEnabled !== undefined) {
			state.enabled = persistedEnabled;
		}

		updateStatus(ctx, state.enabled);
	});

	pi.on("before_agent_start", async (event) => {
		if (!state.enabled) {
			return undefined;
		}

		const systemPrompt = `${event.systemPrompt}\n\n${state.prompt}`;
		return { systemPrompt };
	});
}
