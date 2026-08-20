---
id: pm-8xni
status: closed
open: false
deps: []
links: []
created: 2026-08-20T13:23:26Z
type: bug
priority: 1
assignee: memgrafter
tags: [ai, openai-completions, thinking, replay]
---
# openai-completions: thinking-only assistant messages dropped from replay

Thinking-only assistant messages are silently dropped from replay by convertMessages() in packages/ai/src/api/openai-completions.ts.

## Symptom
When a response is truncated mid-thinking (stopReason: "length", output = maxTokens, content = single thinking block, no text/tool calls), the user sees "Response was truncated before completion." Telling the model to "continue" gives it no memory of what it was thinking — the entire assistant message is absent from the next request.

## Root cause
In convertMessages() (openai-completions.ts, ~line 1236):
1. For thinking-only messages with requiresThinkingAsText=false (default), thinking is placed in a custom field named by thinkingSignature (e.g. "reasoning") while content stays null.
2. The guard "skip assistant messages that have no content and no tool calls" (intended for aborted responses with no content) then drops the whole message:
   if (!hasContent && !assistantMsg.tool_calls) continue;

transformMessages() does NOT skip stopReason "length" (only "error"/"aborted") and preserves the thinking block for same-model — the drop happens only in convertMessages.

## Verified empirically (pi 0.84.2)
Ran installed convertMessages on a real truncated session message (vLLM qwen3.8-27b, openai-completions, thinkingSignature "reasoning", 58,976-char thinking cut mid-sentence) + a "continue" user message. Converted request contained only system + user messages; the thinking was gone.

## Blast radius
All openai-completions providers without requiresThinkingAsText: true drop thinking-only assistant messages from replay (i.e., every response truncated mid-thinking).

## Compounding server-side issue (vLLM + Qwen3 chat template)
Live probes (vLLM 0.27.1, chat_template_kwargs preserve_thinking: true): the template renders the assistant reasoning field only when content is non-empty. content: null or "" + reasoning field -> 0/3 visible. So even a pi-side fix that sends the message with content: null would not restore thinking on such servers; content must be non-empty (or the template patched).

## Suggested fix
In convertMessages(), treat an assistant message carrying thinking in a signature field as having content (do not skip it). For servers whose templates require non-empty content to render reasoning, either send a placeholder content or require requiresThinkingAsText.

## Workaround (verified at pi level)
Set "requiresThinkingAsText": true in the model/provider compat in ~/.pi/agent/models.json. Thinking is then sent back as plain text content; the converted request retains the full thinking and vLLM renders it reliably.

## Repro session
~/.pi/agent/sessions/--Users-trentrobbins-code-prototyping--/2026-08-18T14-34-47-190Z_01a0154b-d816-7448-97ec-e02ddd61ef10.jsonl (last line)

## Notes

**2026-08-20T14:09:48Z**

## Full investigation: every message-exclusion case (2026-08-20)

Traced all message converters in pi-ai + coding-agent. Complete map of where messages are excluded from LLM context.

### Root pattern
Every API converter drops any message that ends up with ZERO content after block-level filtering. Whether a thinking-only assistant message survives depends on where that API serializes thinking:

| API | thinking serialized as | thinking-only msg survives? |
|---|---|---|
| anthropic-messages | content block (thinking/text) | yes |
| google (genai/vertex) | content part | yes |
| bedrock-converse | content block | yes |
| openai-completions | custom field (reasoning/reasoning_content), never content | NO - always dropped |
| openai-responses | only if block has thinkingSignature (encrypted item) | NO - dropped when truncated (no signature) |

### Silent / unexpected drops (the bug class)
1. openai-completions: thinking-only assistant msg ALWAYS dropped (thinking never counts as content). convertMessages() ~line 1236: `if (!hasContent && !tool_calls) continue;`
2. openai-responses: thinking-only msg dropped when reasoning truncated before a complete encrypted signature. openai-responses-shared.ts ~line 294: `if (output.length === 0) continue;`
3. ALL APIs (shared transformMessages.ts ~line 189): assistant stopReason "error" or "aborted" dropped entirely.

### Block-level drops (empty a message, then the whole-message rule drops it)
- empty thinking block (no text, no signature) - all APIs
- redacted thinking, cross-model - transformMessages
- empty text blocks - anthropic/google/bedrock/openai-completions

### Coding-agent level (convertToLlm, core/messages.ts)
- bashExecution with excludeFromContext (!! prefix) - by design

### Context management (by design, not bugs)
- compaction (old msgs summarized, originals excluded)
- context-window pruning (oldest dropped when over budget)

## FIXED

Fixed by extension `extensions/pi-truncated-thinking-marker.ts` in memgrafter-pi-dotfiles (commit 966957b). Hooks message_end and rewrites affected assistant messages in place (agent state + session persistence stay in sync via _replaceMessageInPlace):
- length, thinking-only: prepend marker text so content is non-empty (defeats the openai-completions + openai-responses empty-content drop)
- aborted, with thinking: rewrite stopReason aborted->stop (defeats the shared transformMessages skip); rawStopReason kept as provenance
- thinking block always kept (stays in session + sent back in the reasoning field on replay)
- messages with tool calls NEVER transformed (rewriting an aborted stopReason would make the agent loop execute partially-streamed calls)

The fix is API-agnostic: guaranteeing non-empty text content defeats the empty-content drop in every API, and the stopReason rewrite defeats the shared skip. Covers all three silent-drop cases above.

Verified end-to-end: aborted reasoning preserved in the session file AND replayed into model context; persisted cutoff byte-identical to the TUI (no buffer issue).
