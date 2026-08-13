---
id: mpd-o3ky
status: open
deps: []
links: []
created: 2026-08-12T02:56:01Z
type: feature
priority: 3
assignee: memgrafter
tags: [design, thinking, extension]
---
# deep-think extension: external CoT tool (design ideas)

## Design

External-thinking extension: accumulate the deep_think / sequential-thinking tool ideas from @_can1357's post and its 21 replies, then design one single-file extension (extensions/pi-deep-think.ts) exposing a CoT-capturing "deep_think" tool.

Source: https://x.com/_can1357/status/2087228354399265125 (post: disable thinking, give the model a "deep_think" tool, and it calls it with internal CoT reasoning format — probe image shows openai-codex/gpt-5.6-luna with reasoning effort off calling deep_think {thoughts: <full CoT as JSON string>}; quoted post by @kotekjedi_ml: extraction of hidden reasoning from frontier models, verified reasoning tokens == billed API thinking tokens 1:1).

Accumulated idea set (post + replies):
- A. deep_think tool: register a tool whose JSON param {thoughts} carries the model's internal CoT as plaintext tool-call args → visible in transcript, persists in history across turns, countable as ordinary output tokens, bypasses reasoning-extraction regex, works with native thinking off.
- B. thinking-off combo: force reasoning effort off per provider (payload surgery in before_provider_request) while offering deep_think → CoT without hidden/encrypted reasoning, without triggering extraction classifiers (Fable reasoning_extraction regex hit 6x/day per @_can1357).
- C. sequential thinking: MCP-style numbered steps (thought N/M), append-only explicit structure; already stubbed as sequential_thinking in draft/pi-dynamic-tools.ts; @imaurer: "loved sequential thinking mcp".
- D. bash scratchpad: models spontaneously use bash heredocs to reason when thinking is off (@mitsuhiko) → optional scratch tool or bash-wrap to detect+render heredoc reasoning.
- E. ask nicely: zero-tool variant — instruct model to emit <thoughts> tags / output reasoning afterwards (@torisetxd, @_lyraaaa_ "Asking Nicely just works", @balthazar277).
- F. provenance traces: thinking tool attaches provenance metadata between conversation elements/tool calls and slices sub-components as reasoning traces for sub-agents (@peter_a_goodman) — pairs with tmux-orchestration/sub-agent delegation.
- G. benchmark: A/B deep_think vs native thinking on quality/tokens/latency/cost (@laurolangosco).
- H. trace persistence: persist deep_think calls to a file (pi-prom-round-style) for post-hoc analysis, cost accounting, sub-agent handoff, compaction survival (@hampsonw encrypted-compaction concern).
- I. compaction-aware: re-inject last reasoning trace/summary after compaction (parallel to flexible-role-agent re-injection).
- J. cost transparency: deep_think tokens are ordinary output tokens; show cost delta vs native thinking (extraction attack proved billed thinking tokens 1:1 — externalize and own it).

Design target: ONE single-file extension (pi-deep-think.ts) in extensions/, default-off, enabled via --deep-think flag or /deep-think on|off, providing: deep_think tool (TypeBox schema), optional per-turn CoT budget cap, trace file (JSONL), thinking-off enforcement via before_provider_request per provider (openai-codex reasoning {effort:none}, openai-responses reasoning effort off, anthropic thinking disabled), and a renderCall/renderResult that renders thoughts like native thinking blocks.

## Notes

**2026-08-12T02:56:15Z**

**2026-08-12T02:56:00Z**

Verified pi-mono facts (from ~/clones/pi-mono):

- Thinking levels: `off | minimal | low | medium | high | xhigh | max` (ModelThinkingLevel). ExtensionAPI exposes `ctx.setThinkingLevel(level)` (clamped to model capabilities) and `ctx.getThinkingLevel()`; `thinking_level_select` event fires on change (types.ts:802, 1313+). "off" is not settable via setThinkingLevel (only minimal..max) — forcing off requires per-provider payload surgery.
- Per-provider reasoning off:
  - openai-codex-responses.ts: reasoningEffort "none" -> body.reasoning = { effort: model.thinkingLevelMap?.off ?? "none", summary }. When options.reasoning is undefined, no reasoning field is sent (codex defaults). 
  - openai-responses.ts: `reasoning: { effort: thinkingLevelMap?.off ?? "none" }` when reasoning off and provider != github-copilot; include ["reasoning.encrypted_content"] when reasoning enabled — encrypted_content is what the kotekjedi_ml vuln extracted.
  - pi-thinking-budget.ts (existing extension) shows the before_provider_request pattern: mutate event.payload (add thinking_budget_tokens).
  - anthropic-messages.ts: thinking budget/temperature params.
- Tool registration: `pi.registerTool(ToolDefinition)` with TypeBox schema; `defineTool` helper; ToolDefinition fields: name, label, description, promptSnippet, promptGuidelines, parameters, constrainedSampling, executionMode ("sequential"|"parallel"), renderShell, prepareArguments, execute(toolCallId, params, signal, onUpdate, ctx), renderCall, renderResult (types.ts:449-513).
- Tool result: AgentToolResult { content, details, usage?, addedToolNames?, terminate? } (packages/agent/src/types.ts:355).
- Tool call interception: `tool_call` event handler can block execution (ToolCallEventResult { block?, reason? }); `tool_result` event can replace content (ToolResultEventResult).
- Thinking content in history: ThinkingContent { type:"thinking", thinking, thinkingSignature? } is part of AssistantMessage.content; transformMessages keeps thinking blocks with signatures for same-model replay, converts to plain text for cross-model, drops empty blocks (api/transform-messages.ts:101-115). This is the key contrast: deep_think's CoT lives in tool-call args (plaintext, always visible to user + model next turn), native thinking can be encrypted/redacted (thinkingSignature = opaque encrypted payload) and is provider-filtered.
- Custom messages: `pi.sendMessage({customType, content, display, details})` — stored in session, sent as user message (cache-safe append); `pi.appendEntry(customType, data)` — state persistence, not sent to LLM. Pattern used by flexible-role-agent for role persistence.
- Commands: `pi.registerCommand(name, {description, handler})`; flags: `pi.registerFlag`. Compaction: re-inject state after compaction via session_start/compaction events (flexible-role-agent pattern).
- before_provider_request: BeforeProviderRequestEvent { type, payload: unknown } — handlers mutate payload or return replacement; pi-thinking-budget.ts is the reference.

Open design questions:
1. Enforce thinking-off automatically, or only when user opts in (--deep-think)? Auto-off changes behavior of existing sessions; opt-in is safer (default).
2. Budget cap: max chars/tokens per thoughts param, per-turn call count cap — enforce in execute() or via promptGuidelines only?
3. Trace file location: ~/.pi/agent/deep-think/<sessionId>.jsonl vs cwd .pi/deep-think/ (repo-versionable)?
4. deep_think tool result content: minimal ack ("recorded") vs echo summary — affects tokens/cache but also model's ability to continue reasoning.
5. renderCall/renderResult: render thoughts as native-thinking-style block, or plain tool frame (renderShell "self" vs "default")?
6. Sequential mode (idea C): same extension with `mode: "sequential"` param (numbered steps) vs separate extension/flag?
7. Bash heredoc detection (idea D): wrap bash tool or skip? Wrapping bash risks breaking existing tool behavior.
8. Compaction re-injection (idea I): store last trace in appendEntry and re-inject post-compaction — same pattern as frag roles; confirm wording.
9. Which providers to support for thinking-off surgery first: openai-codex, openai-responses, anthropic, google — order by user usage.
10. Does deep_think work with non-reasoning models (reasoning:false, only "off" supported)? Those are the primary target — tool works regardless; verify against deepseek-v4-flash (no native thinking) vs gpt-5.6-luna.
