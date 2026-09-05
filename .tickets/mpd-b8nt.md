---
id: mpd-b8nt
status: closed
open: false
deps: []
links: [mpd-sr7t]
created: 2026-08-12T22:48:09Z
type: feature
priority: 2
assignee: memgrafter
---
# Compaction modes: make keepRecentTokens configurable

Make the effective `keepRecentTokens` (pi's "session too small" compaction guard)
configurable from the extension's own settings section. Option A from the
discussion: extension writes pi's `compaction.keepRecentTokens` into project
settings and reloads. No upstream pi change.

## Background (verified)

- pi's `compact()` calls `prepareCompaction(pathEntries, settings)` BEFORE
  `session_before_compact` fires. When the session's message tokens are below
  `settings.compaction.keepRecentTokens`, `findCutPoint` finds nothing to cut,
  `messagesToSummarize` is empty, `prepareCompaction` returns undefined, and pi
  throws `"Nothing to compact (session too small)"`. The extension hook is
  unreachable, so the guard cannot be overridden per-compaction from an event.
- `ExtensionContext` has no settings access; `CompactOptions` is only
  `customInstructions` + callbacks.
- `ctx.reload()` (and `pi.reload()` on ExtensionAPI) reloads extensions, skills,
  prompts, themes, context files AND calls `settingsManager.reload()`, which
  re-reads project + global settings and re-merges
  (`resource-loader.ts:383,402`). After reload the old ctx is stale; the
  extension runtime is re-created and `session_start` fires again with
  `reason: "reload"`.
- pi's effective value = project `.pi/settings.json` `compaction.keepRecentTokens`
  ?? global `~/.pi/agent/settings.json` `compaction.keepRecentTokens`
  ?? `20000` (DEFAULT_COMPACTION_SETTINGS; user global is 5000). Project wins
  over global via `deepMergeSettings`.

## Implementation (extensions/pi-compaction-modes.ts only)

New config key: `pi-compaction-modes.compaction.keepRecentTokens` (number).
Unset => no-op, leave pi's setting untouched.

Add helper `syncKeepRecentTokens(pi, ctx)` and call it from the existing
`session_start` handler, guarded by `event.reason === "startup"` (skip
"reload"/"new"/"resume"/"fork").

Steps in `syncKeepRecentTokens`:

1. Read configured value:
   `project[pi-compaction-modes].compaction?.keepRecentTokens ??
   global[pi-compaction-modes].compaction?.keepRecentTokens`
   (reuse existing `getProjectSettingsPath`, `getGlobalSettingsPath`,
   `readJsonObject`). If undefined, return.
2. Compute pi's current effective value the same way pi does:
   `project.compaction.keepRecentTokens ?? global.compaction.keepRecentTokens ?? 20000`.
3. If configured === current, return. (This also terminates the reload
   re-entry loop: after the first reload, step 3 matches and nothing happens.)
4. Read-modify-write PROJECT settings (`<cwd>/.pi/settings.json`, mkdir -p
   first): set `compaction = { ...existing.compaction, keepRecentTokens }`,
   preserving `enabled` and `reserveTokens`. Write the whole file with the
   existing `writeFileSync` + JSON formatting used by `writeConfiguredMode`.
   Never write global settings.
5. Schedule a deferred reload so it does not race the boot sequence:
   `setTimeout(() => { void pi.reload(); }, 1000)`. Use `pi.reload()` (the
   ExtensionAPI object), not `ctx` — after reload the ctx is stale.
6. On read/write failure: `ctx.ui.notify("Could not apply pi-compaction-modes
   compaction.keepRecentTokens: <err>", "warning")` and return.

Notes:
- Extension reload resets module-level `danceState`; harmless (dance is
  per-compaction, not persisted across reloads).
- Lowering `keepRecentTokens` also changes what pi's builtin `vanilla` mode
  keeps; that is the point of configuring it.
- `session_start` reasons: `"startup" | "reload" | "new" | "resume" | "fork"`
  (extensions/types.ts:565).

## Testing (extensions/tests/compaction/live)

New scenario `small` in `drive_special.py` + seed case in `run_special.sh`:

- Seed `runs/small/.pi/settings.json`:
  `{ "pi-compaction-modes": { "mode": "cached", "compaction": { "keepRecentTokens": 100 } } }`
- Drive: boot, haiku ONLY (no 132KB filler), `/compact` — must succeed
  (previously: "session too small").
- Verify: compaction entry present, `details.mode === "cached"`, exactly one
  injected dance message; `runs/small/.pi/settings.json` now contains
  `compaction.keepRecentTokens: 100` (proves the write); session file has no
  `"Nothing to compact"` error.
- Regression: full 8-mode matrix (run.sh + verify.py) must stay ALL PASS — the
  no-config path is unchanged.
- Optional: re-run `modearg`/`modearg-reverse` after the change.

## Files

- `extensions/pi-compaction-modes.ts` (only extension change)
- `extensions/tests/compaction/live/drive_special.py`,
  `extensions/tests/compaction/live/run_special.sh`, README note

## Effort

~50-80 lines + live test, 1.5-2.5h.

## Out of scope

Upstream pi-mono changes (Option B: emit `session_before_compact` with empty
preparation, or add `compaction.minTokens` to pi) — separate ticket if wanted.

## Notes

**2026-08-14T13:36:21Z**

Closed per user decision 2026-08-12: keepRecentTokens configurability not needed. Workaround in place — the live harness seeds per-run project settings and grows session context past the 5000-token guard before /compact (verified in the mpd-sr7t campaign). The detailed implementation plan above remains valid if this is ever wanted.
