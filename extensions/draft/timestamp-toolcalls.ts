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
 *   /timestamp — show current timestamp
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

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
	pi.registerCommand("timestamp", {
		description: "Show current timestamp",
		handler: async (_args, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(`timestamp ${localTimestamp()}`, "info");
		},
	});

	pi.on("input", async (event) => {
		return {
			action: "transform" as const,
			text: `${event.text}\n\ntimestamp ${localTimestamp()}`,
			images: event.images,
		};
	});
}
