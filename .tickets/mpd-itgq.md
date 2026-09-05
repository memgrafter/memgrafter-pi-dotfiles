---
id: mpd-itgq
status: open
open: true
deps: []
links: [mpd-9kvy]
created: 2026-08-11T17:24:54Z
type: feature
priority: 3
assignee: memgrafter
tags: [design, modes, extension, cache, on-ice]
---
# Modes extension: cache-aware mode/role swapping (design)

ON ICE design ticket. Single modes extension driven by data files (modes/*.md, frontmatter): --mode <filepath|filename> flag, /mode + /mode set <mode> commands, auto-discovery from extension packages + settings-registered paths. Cache-aware: role swaps inject a post-history user message ('System: <content>') and never touch the system prompt (no cache bust); mode swaps warn via a center box (Continue/Cancel) and may fork the session so the old chat keeps its warm cache. Initial modes: base (identity replica) + dynamic role. Full requirements, verified pi-mono facts, design, and 7 open questions + 4 assumed defaults in design notes.

## Design

# Modes extension: cache-aware mode/role swapping

## Status

**ON ICE** — design ticket only. No implementation until re-scoped. All information and open questions from the scoping conversations are preserved below.

## Background

The repo has four near-identical "mode" extensions (`pi-cbt-mode.ts`, `pi-dp-mode.ts`, `pi-pkm-mode.ts`, `pi-socratic-tutor-mode.ts`) that all use the same pattern: a `before_agent_start` handler receives the fully assembled system prompt and appends a persona prompt, returning `{ systemPrompt }`. Analysis of that method (pros/cons) is in conversation history; the short version: it is always-on and self-correcting per turn, but re-sends the persona every turn, cannot surgically edit prompt sections, is order-dependent across extensions, and any system-prompt change busts the provider cache.

Goal: replace/extend this with a single **modes extension** driven by data files, with explicit **cache-awareness**: role swaps never touch the system prompt (so they never bust cache); mode swaps warn the user (center box) before applying because they will bust cache, and may fork the session so the old conversation keeps its warm cache.

## Requirements (user-stated)

1. One modes extension. Do NOT include the existing four modes.
2. One `--mode <filepath/filename>` CLI flag (filename resolves against the searchable mode set; filepath used directly).
3. `/mode` shows the current mode. `/mode set <mode>` finds the mode via its **frontmatter**.
4. Modes are a searchable set, discovered automatically from extension packages such as `~/code/memgrafter-pi-dotfiles/modes/`, optionally registerable in settings or by another path.
5. Initial two modes in `modes/`:
   - **base** — the existing base mode in the TypeScript (exact replica).
   - **dynamic role** — a dynamic role mode. Past messages are not deleted. The system message tells the agent it is a flexible mode agent and will receive the mode at the end of the messages; then the post-history message ("system reminder" — pi terminology to be confirmed, see Q6) gives the dynamic role.
6. The system reminder format the user uses:
   `<user message>\n\nSystem: <Mode Content in free format multiline>`
7. **Cache constraints (core design driver):**
   - We cannot break cache when changing the **role**. The role must persist in the chat history; the system message must not change. Generally better to simply start a new chat than to bust cache.
   - It is fine to only inject a new role on role change (not every turn).
8. Use cases:
   - **Swapping modes** (full set of prompt data) on an old chat, e.g. analysis/review. If cache is warm, we want to keep it, but sometimes it is cold. Sometimes the user really does not want the same system message — the mode file should simply be the decider. Requires a **cache-bust warning with cancel-send** (center box with options), because the user may not realize they have a problem. Reference UI example: `~/code/autocatalytic-infra/panopticon/prediction-trainer/`.
   - **Swapping roles** (just the system reminder / post-history message). This should never bust cache. Probably the same center box with options.
9. A single session mode needs **multiple "post history instruction / system reminder" modes** — separate composed files is the simplest approach (base template resolution is an alternative).
10. Center box behavior: activated after switching modes **iff the new mode's system prompt is not the same as the previous mode's**. Default text: `Warning: mode change X -> Y will bust any existing cache on next prompt submission.` Options: **Continue** (default) and **Cancel**. Only Continue changes the mode; Cancel does nothing.
11. After a mode change, decide how the session history is updated. We **may want to always fork the session on system-prompt mode change**, so the old conversation retains its cache and the new chat has its own cache.

## Verified pi-mono facts (from ~/clones/pi-mono)

- **No literal "system reminder" slot exists in pi.** The closest analogues:
  - `before_agent_start` → `message`: injects a persistent `custom`-role message (sent to providers as a user message, **stored in the session**).
  - `before_provider_request`: replace the raw API payload per request (**transient, never stored**; payload shape is provider-specific).
  - `before_agent_start` → `systemPrompt`: what the current mode extensions use.
- `BeforeAgentStartEventResult = { message?, systemPrompt? }` (`packages/coding-agent/src/core/extensions/types.ts:1097`). `BeforeAgentStartEvent` carries `prompt`, `images?`, `systemPrompt` (fully assembled), `systemPromptOptions` (structured).
- `emitBeforeAgentStart` chains handlers in extension registration order; each sees the running prompt; per-handler error isolation; `ctx.getSystemPrompt()` reflects the chained value.
- Per-turn lifecycle: override stored in `_systemPromptOverride`, reset in `_runAgentPrompt` finally; re-derived each turn; `prepareNextTurnWithContext` carries it through mid-run continuations (regression test `6162-extension-active-tools-next-turn.test.ts`).
- `buildSystemPrompt` / `BuildSystemPromptOptions` fields (`packages/coding-agent/src/core/system-prompt.ts`): `customPrompt` (full replacement), `appendSystemPrompt` (suffix), `promptGuidelines`, `selectedTools` + `toolSnippets`, `contextFiles` (AGENTS.md etc.), `skills`, `cwd` → final `systemPrompt` string.
- **Session fork is first-class**: `ctx.sessionManager.fork(entryId, { position: "before"|"at", withSession })` creates a new session file with copied content; also `newSession({ parentSession })`, `switchSession(path)`, `navigateTree`, cancellable `session_before_fork` event.
- **Center box UI**: `ctx.ui.setWidget(id, factory, { overlay: true, overlayOptions: { anchor: "center" } })` with custom `render`/`handleInput` (bordered box, arrow-key nav, Enter confirm, Esc cancel) — the panopticon pattern. Built-in alternative: `ctx.ui.select(title, options[], opts)`.
- Message roles: `user`, `assistant`, `toolResult`, `custom { customType, content, display, details }`.
- Cache mechanics (provider prompt caching): appending a user message at the END of the conversation does NOT invalidate the cached prefix (system + earlier messages). Any system-prompt change does.
- Compaction uses a fixed `SUMMARIZATION_SYSTEM_PROMPT`, not the user's system prompt; re-injected role messages restore the role after compaction (extension must handle this).

## Fields needed to compose a prompt in pi (answer to the user's question)

System prompt (any change busts cache): `customPrompt`, `appendSystemPrompt`, `promptGuidelines`, `selectedTools`+`toolSnippets`, `contextFiles`, `skills`, `cwd` → final `systemPrompt` string.
Cache-safe message slots: `user` (text+images), `custom` (`{customType, content, display, details}` — sent as user message, stored in session). History: assistant / toolResult (not composed).
So a mode file needs at most: **system section** (`append` vs `replace`), **zero+ role references** (each a `custom` message with content formatted `System:\n<multiline>`), plus metadata (`name`, `description`, `type`).

## Proposed design (working model, pending Q answers)

- **Mode file** (`modes/<name>.md`, YAML frontmatter + body):
  - `identity` type (base/vanilla — no modification; the `.md` is documentation only, since a literal replica of pi's base prompt is impossible — it is dynamic: cwd, skills, AGENTS.md, active tools).
  - `static` type: body appended to system prompt (current method).
  - `dynamic` type: body goes in the system prompt (flexible-mode-agent preamble); the `role` (frontmatter or runtime-overridden) is injected post-history each turn.
- **Discovery**: `<extensionDir>/../modes/` (auto — covers the memgrafter repo), `~/.pi/agent/modes/`, `<project>/.pi/modes/`, plus extra dirs from a `mode_paths` array in `.pi/settings.json` / global settings.
- **Commands**: `/mode` (show), `/mode set <name>` (persisted as a custom session entry), `/mode list [filter]`. Modes exclusive (setting one clears the previous).
- **Dynamic-role update — candidate mechanisms:**
  1. `/mode role <text>` — persistent post-history message, latest-wins; inject only on role change (preamble: "most recent role message is authoritative"). Simple, provider-agnostic, visible, survives compaction (re-injected fresh).
  2. Role from a file (`/mode role file <path>` or `role_path` frontmatter) — re-read per turn; external edits update the role; git-versionable. Combine with 1.
  3. Transient `before_provider_request` injection — role spliced into payload only; zero accumulation; but provider-specific payload surgery, invisible in transcripts/compaction, fragile.
  4. Role in system prompt — simplest, no accumulation, but not post-history (defeats the mechanism).
  - **Per-turn duplication trap**: injecting a `message` every turn duplicates it per turn (turn N has N copies). Must inject only on role change — track last-injected role text; on `session_start` scan session messages for the most recent `mode-role` message to avoid re-injecting after restart; re-inject if compaction dropped it.
  - Lean recommendation: 1 + 2 (inline command + optional file source); 3 documented as alternative.
- **Center box**: panopticon overlay-widget pattern (`setWidget`, anchor center). Shown on `/mode set` when new mode's system section != current (persisted entry comparison; unrecorded = base/identity). Continue (default) applies; Cancel does nothing. Role swaps get the same box (options per Q4).
- **Fork semantics**: fork current entry into a new session file on mode change (optionally), old session untouched → old cache stays valid; fork gets its own cache. `withSession` callback sets the new mode on the new session.

## Open questions

Blockers:
1. **Post-Continue flow**: apply the mode in place, fork automatically, or offer "Fork" as a third option? (Lean: third option Continue/Fork/Cancel, Fork also switches active session.) The `/mode set` turn is consumed by the command; next user message runs under new mode/fork — confirm.
2. **"The mode file is the decider"**: full replacement (`system: replace`, drops pi's default prompt; dynamic parts like AGENTS.md/skills/tools are the file author's responsibility) or append-only (`system: append`)? Determines cache-bust scope and how much each mode file must replicate.
3. **Cache-bust comparison basis**: warn iff new mode's *system section* differs from currently applied one (persisted session entry; unrecorded = base/identity). Compare mode content only, or full composed strings?
4. **Role-change box options**: role swap never busts cache — box is confirmational (Apply/Cancel) or includes Fork too?
5. **Role file layout**: per-mode `modes/<mode>.roles/<role>.md` vs global `modes/roles/<role>.md` (any mode references; frontmatter `role: <name>` picks default). Lean: global roles + per-mode default.
6. **Reminder shape**: is the injected message content exactly `System:\n<multiline content>` as its own user message (no preceding user text in the same message)? The user's `<user message>\n\nSystem: ...` is read as *position*, not content — confirm.
7. **Restart/edge case**: on fresh session or fork, read last `mode-role` message from history; if absent, inject the mode's default role on the first turn (also survives compaction). Confirm.

Defaults assumed (unless objected):
8. `--mode <name>` sets mode + default role on a fresh session, no warning needed (no existing cache).
9. Mode and role persist as session entries (`mode`, `mode-role`); roles are files only (no inline `/mode role <text>`), editable to update.
10. Center box built as the panopticon overlay widget, not `ctx.ui.select`.
11. The four existing mode extensions stay untouched/coexisting for now.

## Out of scope / deferred

- Whether the four existing mode extensions are retired or migrated to mode files.
- Base template resolution for composed roles (alternative to separate composed files).
- Inline `/mode role <text>` (see Q/default 9).
- `before_provider_request` transient injection implementation (documented alternative only).
