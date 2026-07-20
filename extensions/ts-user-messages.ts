/**
 * Pi Timestamp Extension
 *
 * Appends a local timestamp to every user message so the agent
 * always knows the current time. The timestamp is part of the
 * persisted user message in the session log.
 *
 * Timestamp format: YYYY-MM-DDTHH:MM:SS  (local time, no timezone suffix)
 * Compatible with: find <dir> -newermt "2026-03-19T02:15:00" -type f
 *
 * Usage:
 *   /timestamp          — toggle appending ts to user message
 *   /timestamp on       — enable timestamp appending (default: off)
 *   /timestamp off      — disable timestamp appending
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SETTINGS_SECTION = "ts-user-messages";

function getProjectSettingsPath(cwd: string): string {
	return join(cwd, ".pi", "settings.json");
}

function getGlobalSettingsPath(): string {
	return join(homedir(), ".pi", "agent", "settings.json");
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
	if (!existsSync(filePath)) return;
	const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
	return parsed && typeof parsed === "object" && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: undefined;
}

function readEnabledFromSettings(filePath: string): boolean | undefined {
	const settings = readJsonObject(filePath);
	const section = settings?.[SETTINGS_SECTION];
	if (!section || typeof section !== "object" || Array.isArray(section)) return;
	const enabled = (section as { enabled?: unknown }).enabled;
	return typeof enabled === "boolean" ? enabled : undefined;
}

function resolveEnabled(cwd: string): boolean {
	return readEnabledFromSettings(getProjectSettingsPath(cwd)) ?? readEnabledFromSettings(getGlobalSettingsPath()) ?? false;
}

function getSettingsPathToUpdate(cwd: string): string {
	const projectSettings = readJsonObject(getProjectSettingsPath(cwd));
	return projectSettings?.[SETTINGS_SECTION] !== undefined
		? getProjectSettingsPath(cwd)
		: getGlobalSettingsPath();
}

function writeEnabled(cwd: string, enabled: boolean): void {
	const settingsPath = getSettingsPathToUpdate(cwd);
	const settings = readJsonObject(settingsPath) ?? {};
	const section = settings[SETTINGS_SECTION];
	const nextSection = section && typeof section === "object" && !Array.isArray(section)
		? section
		: {};

	settings[SETTINGS_SECTION] = { ...nextSection, enabled };
	mkdirSync(join(settingsPath, ".."), { recursive: true });
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

function localTimestamp(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		now.getFullYear() +
		"-" +
		pad(now.getMonth() + 1) +
		"-" +
		pad(now.getDate()) +
		"T" +
		pad(now.getHours()) +
		":" +
		pad(now.getMinutes()) +
		":" +
		pad(now.getSeconds())
	);
}

export default function timestampExtension(pi: ExtensionAPI): void {
	let enabled = false;

	pi.registerFlag("timestamp", {
		description: "Start with timestamp appending enabled",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("timestamp", {
		description: "Toggle appending ts to user message (or use: /timestamp on|off)",
		handler: async (args, ctx) => {
			const normalized = args.trim().toLowerCase();

			if (normalized === "on" || normalized === "enable" || normalized === "enabled") {
				enabled = true;
			} else if (normalized === "off" || normalized === "disable" || normalized === "disabled") {
				enabled = false;
			} else {
				enabled = !enabled;
			}

			writeEnabled(ctx.cwd, enabled);
			ctx.ui.notify(`timestamp ${enabled ? "on" : "off"}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("timestamp") === true) {
			enabled = true;
		} else {
			enabled = resolveEnabled(ctx.cwd);
		}
	});

	pi.on("input", async (event) => {
		if (!enabled) return undefined;

		return {
			action: "transform" as const,
			text: `${event.text}\n\ntimestamp ${localTimestamp()}`,
			images: event.images,
		};
	});
}
