/**
 * pi Redraw Screen Extension
 *
 * Adds:
 * - /redraw command
 * - optional keyboard shortcut (no default — configure via settings.json)
 *
 * To bind a shortcut, add to ~/.pi/agent/settings.json:
 *   "redraw_shortcut": "ctrl+r"
 *
 * If binding ctrl+r, also rebind renameSession in ~/.pi/agent/keybindings.json:
 *   "renameSession": ["ctrl+shift+r"]
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type ShortcutId = Parameters<ExtensionAPI["registerShortcut"]>[0];

const DEFAULT_REDRAW_SHORTCUT: ShortcutId | null = null;

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

/**
 * Returns:
 * - string: shortcut configured
 * - null: explicitly disabled
 * - undefined: not configured
 */
function parseRedrawShortcutSetting(value: unknown): string | null | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const settings = value as Record<string, unknown>;
	const raw = settings.redraw_shortcut ?? settings.redrawShortcut;

	if (raw === undefined) {
		return undefined;
	}

	if (raw === null || raw === false) {
		return null;
	}

	if (typeof raw !== "string") {
		return undefined;
	}

	const normalized = raw.trim().toLowerCase();
	if (
		normalized.length === 0 ||
		normalized === "none" ||
		normalized === "off" ||
		normalized === "disabled"
	) {
		return null;
	}

	return normalized;
}

function resolveRedrawShortcutFromPiSettings(cwd: string): ShortcutId | null {
	const projectSettingsPath = join(cwd, ".pi", "settings.json");
	const globalSettingsPath = join(homedir(), ".pi", "agent", "settings.json");

	const projectValue = parseRedrawShortcutSetting(readJsonFile(projectSettingsPath));
	if (projectValue !== undefined) {
		return projectValue as ShortcutId | null;
	}

	const globalValue = parseRedrawShortcutSetting(readJsonFile(globalSettingsPath));
	if (globalValue !== undefined) {
		return globalValue as ShortcutId | null;
	}

	return DEFAULT_REDRAW_SHORTCUT;
}

async function forceFullRedraw(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
	if (!ctx.hasUI) {
		return false;
	}

	pi.events.emit("redraw", {});

	await ctx.ui.custom<void>((tui, _theme, _keybindings, done) => {
		tui.requestRender(true);
		done();
		return {
			render: () => [],
			invalidate: () => {},
		};
	});

	return true;
}

export default function piRedrawScreenExtension(pi: ExtensionAPI): void {
	pi.registerCommand("redraw", {
		description: "Force full screen redraw",
		handler: async (_args, ctx) => {
			const redrawn = await forceFullRedraw(pi, ctx);
			if (redrawn) {
				ctx.ui.notify("Screen redrawn", "info");
			}
		},
	});

	const shortcut = resolveRedrawShortcutFromPiSettings(process.cwd());
	if (shortcut !== null) {
		pi.registerShortcut(shortcut, {
			description: "Force full screen redraw",
			handler: async (ctx) => {
				await forceFullRedraw(pi, ctx);
			},
		});
	}
}
