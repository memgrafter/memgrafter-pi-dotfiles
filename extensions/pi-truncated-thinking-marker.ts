import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Truncated/aborted thinking marker.
 *
 * Preserves assistant messages that carry thinking but no visible text so
 * they survive replay into the LLM context:
 *
 * 1. stopReason "length" (token limit hit mid-reasoning):
 *    convertMessages() in pi-ai drops assistant messages with no text content
 *    and no tool calls, so a thinking-only truncated message vanishes from
 *    replay entirely. Prepending a text marker gives the message non-empty
 *    content so it is kept.
 *
 * 2. stopReason "aborted" (user pressed ESC mid-response):
 *    transformMessages() skips ALL aborted assistant messages, thinking or
 *    not. The replacement rewrites stopReason to "stop" so the message is
 *    replayed. rawStopReason is left untouched as provenance.
 *
 * The thinking block is always kept (not replaced) so the partial reasoning
 * stays in the session file and is sent back in the reasoning field on
 * replay. vLLM Qwen3 chat templates with preserve_thinking render that field
 * only when content is non-empty, which the marker guarantees for
 * thinking-only messages.
 *
 * Safety: messages containing tool calls are never transformed.
 *  - "length": the agent loop already fails them (truncated arguments).
 *  - "aborted": rewriting stopReason would make the agent loop EXECUTE
 *    partially-streamed tool calls.
 *
 * Disable by renaming this file to pi-truncated-thinking-marker.ts.disabled.
 */
export default function (pi: ExtensionAPI) {
	pi.on("message_end", (event) => {
		const m = event.message;
		if (m.role !== "assistant") return;
		if (m.stopReason !== "length" && m.stopReason !== "aborted") return;

		const hasText = m.content.some((b) => b.type === "text" && b.text.trim().length > 0);
		const hasToolCalls = m.content.some((b) => b.type === "toolCall");
		if (hasToolCalls) return;

		// "length" with visible text already survives replay; nothing to do.
		if (m.stopReason === "length" && hasText) return;

		// "aborted" with no thinking has nothing worth preserving.
		if (m.stopReason === "aborted" && !m.content.some((b) => b.type === "thinking" && b.thinking.trim().length > 0)) {
			return;
		}

		const content = hasText
			? m.content
			: [
					{ type: "text" as const, text: "System:\n\nResponse stopped during reasoning." },
					...m.content,
				];

		return {
			message: {
				...m,
				content,
				// Only "aborted" needs the stopReason rewritten; transformMessages
				// skips "aborted"/"error" but replays "stop" and "length".
				...(m.stopReason === "aborted" ? { stopReason: "stop" as const } : {}),
			},
		};
	});
}
