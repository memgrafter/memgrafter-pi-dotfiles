/**
 * pi-tree-prewarm
 *
 * Before /tree executes, send one normal user message on the original thread.
 * On that warm request, add a 3rd explicit cache breakpoint on the selected tree target message.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function getLastText(content: unknown): string | null {
	if (typeof content === "string") return content;
	if (!Array.isArray(content) || content.length === 0) return null;
	const last = content[content.length - 1] as any;
	if (last && typeof last === "object" && last.type === "text" && typeof last.text === "string") {
		return last.text;
	}
	return null;
}

function getLastUserCacheControlValue(messages: any[]): any | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m?.role !== "user") continue;
		if (!Array.isArray(m.content) || m.content.length === 0) continue;
		const b = m.content[m.content.length - 1];
		if (b?.cache_control?.type === "ephemeral") {
			return { ...b.cache_control };
		}
	}
	return null;
}

export default function (pi: ExtensionAPI) {
	let warmPending = false;
	let targetRole: "user" | "assistant" | null = null;
	let targetText: string | null = null;

	pi.on("session_before_tree", async (event, ctx) => {
		const target = ctx.sessionManager.getEntry(event.preparation.targetId) as any;
		if (!target || target.type !== "message") return;

		const role = target.message?.role;
		const text = getLastText(target.message?.content);
		if ((role !== "user" && role !== "assistant") || !text) return;

		targetRole = role;
		targetText = text;
		warmPending = true;

		pi.sendUserMessage("ok");
		await ctx.waitForIdle();
	});

	pi.on("before_provider_request", (event) => {
		if (!warmPending || !targetRole || !targetText) return;
		warmPending = false;

		const payload = event.payload as any;
		if (!payload?.messages || !Array.isArray(payload.messages)) return;

		// Reuse pi-mono's cache_control value from the current last user block.
		const cacheControl = getLastUserCacheControlValue(payload.messages);
		if (!cacheControl) return;

		for (let i = payload.messages.length - 1; i >= 0; i--) {
			const m = payload.messages[i];
			if (m?.role !== targetRole) continue;
			if (getLastText(m.content) !== targetText) continue;

			if (Array.isArray(m.content) && m.content.length > 0) {
				const last = m.content[m.content.length - 1];
				if (last && typeof last === "object" && !last.cache_control) {
					last.cache_control = cacheControl;
				}
			} else if (typeof m.content === "string") {
				m.content = [{ type: "text", text: m.content, cache_control: cacheControl }];
			}
			break;
		}

		targetRole = null;
		targetText = null;
		return payload;
	});
}
