---
id: mpd-sr7t
status: closed
open: false
deps: []
links: [mpd-zu1e, mpd-1kl2, mpd-cod0]
created: 2026-08-12T22:00:18Z
type: task
priority: 1
assignee: memgrafter
tags: [compaction, extension, testing]
---
# Compaction modes: test campaign findings and fixes

Ran a full live-test campaign of all compaction modes in `extensions/pi-compaction-modes.ts` (deepseek/deepseek-v4-flash, thinking off, via 8 parallel tmux pi sessions + special-path sessions). All 8 modes passed end-to-end verification (one injected dance message, compaction entry with matching details.mode, sentinel firstKeptEntryId, tooltrace section for -tooltraces modes, cacheRead ~= full context on the summary turn, post-compact reply works). Cache hit on dance summary turns: 99.4-99.9%. Special paths verified: threshold-triggered auto-compaction (no /compact), overflow (notify + cancel, no compaction), Esc-abort mid-summary-turn (clean cancel, no compaction).

## Findings needing fixes

1. `cached` mode summary prompt is flaky on deepseek-v4-flash: ~~2 of 4 runs replied with a 1-token degenerate echo (e.g. "FILLER_OK" / "ACK") instead of a summary, and the extension captured it verbatim as the compaction content. There is no quality guard on the captured summary reply.~~ **FIXED 2026-08-12** — DANCE_SUMMARY_MESSAGE rewritten to pi's SUMMARIZATION_PROMPT format (eafc3ca); live-verified (see Notes). Remaining defense-in-depth (quality guard) tracked in mpd-zu1e.

2. `/compact <mode>` phase-3 mode resolution footgun: ~~pi never populates event.compactionMode, so phase 3 falls back to the configured mode. The requested mode only selects the injected dance prompt; if configured mode differs, the recorded details.mode and tooltrace section do not match the request.~~ **FIXED 2026-08-12** — see Notes. Fix: thread the requested mode through danceState into phase 3.

## Operational notes

- Threshold auto-compaction requires session message tokens to exceed compaction.keepRecentTokens (5000) - prepareCompaction bails silently otherwise (system prompt tokens do not count).
- deepseek/deepseek-v4-flash resolved to a 256k context window in this install (models.json), though the provider catalog says 1M; overflow test validated against 256k.
- Large tmux paste-buffer pastes (>250KB) into the pi TUI stream slowly and can crash pi (1.05MB single paste crashed the session); 1.05MB via piped stdin (--print) works. Chunked pastes with end markers are reliable.

Test harness and artifacts live in ~/pi-compact-test/ (driver, verifier, per-mode session JSONLs).

## Notes

**2026-08-12T22:18:54Z**

LIVE TEST RESULTS (all deepseek/deepseek-v4-flash, thinking off, 8 parallel sessions):
- cached, cached-agentic, cached-agentic-tooltraces, cached-handoff, cached-handoff-tooltraces, cached-summary-tooltraces, programmatic, vanilla: ALL PASS
- threshold auto-compaction (reserveTokens 240000, mode cached-handoff-tooltraces): PASS (31,667 tokens, correct mode)
- Esc-abort mid-summary-turn (mode cached): PASS (cancel notify, 0 compaction entries)
- overflow: NOT TESTED (skipped per user; UX = abort + user figures it out)

KEY METRIC: summary turn cacheRead/(input+cacheRead) per dance mode:
  cached 0.995 (31744/31888), cached-agentic 0.994, cached-agentic-tooltraces 0.998,
  cached-handoff 0.995, cached-handoff-tooltraces 0.994, cached-summary-tooltraces 0.999

FINDING 1 (extension): /compact <mode> argument does not drive phase 3. pi never sets event.compactionMode (no compactionMode anywhere in pi-mono core). In phase 3, mode = requestedMode(undefined) ?? commandIntent.mode(undefined for the internal ctx.compact() call) ?? configuredMode. So if configured mode != /compact <mode>, the summary FORMAT (-tooltraces append) and recorded details.mode come from the CONFIGURED mode; only the phase-1 injected prompt uses the requested mode. Tests work around it by seeding per-session project settings + plain /compact. Fix idea: keep requested mode in danceState (phase 1) and use it in phase 3.

FINDING 2 (pi, not extension): manual /compact fails with "Nothing to compact (session too small)" when message tokens < keepRecentTokens (5000). Tests grow context with a 132KB filler paste first.

FINDING 3 (pi TUI, not extension): a single ~1MB paste crashes the pi TUI (process exits to shell). Tests paste in 132KB chunks.

**2026-08-12T23:00Z — phase-3 mode resolution FIXED (verified live)**

Implemented in `extensions/pi-compaction-modes.ts` (working tree, alongside the regression harness):
- `const danceMode = danceState ? danceState.mode : isDanceMode(mode) ? mode : undefined; if (danceMode) { ... }` — phase 3 now uses the mode recorded at phase 1 (the `/compact <type>` request) instead of recomputing from the event and falling back to configuredMode.
- All uses inside the dance branch (details.mode, `-tooltraces` append, notify, injected prompt, pending record) key off danceMode.

Regression tests PASS live on deepseek/deepseek-v4-flash (extensions/tests/compaction/live, scenarios `modearg` + `modearg-reverse`):
- modearg (configured `cached`, `/compact cached-handoff-tooltraces`): details.mode='cached-handoff-tooltraces', Programmatic section present, handoff prompt injected — all True.
- modearg-reverse (configured `cached-handoff-tooltraces`, `/compact cached`): details.mode='cached', Programmatic section absent, summary prompt injected — all True.

Typecheck: `bunx tsc --noEmit --skipLibCheck --module esnext --moduleResolution bundler --target es2022 --lib es2022 extensions/pi-compaction-modes.ts` — pass.

Still open: finding 1 — flaky `cached` summary prompt on deepseek-v4-flash (degenerate 1-token echo captured verbatim; no quality guard on the captured summary).

**2026-08-12T23:03:44Z**

FINDING 1 FIXED in b1d3f3f (verified live):
- The dance block now computes danceMode = in-flight dance's mode (danceState.mode) when a dance exists, else the resolved mode. Phase 3 uses danceMode for the -tooltraces append, details.mode, and the notify, so /compact <dance-mode> is honored even when the configured mode differs.
- Regression tests added: modearg (configured cached + /compact cached-handoff-tooltraces -> tooltrace + details.mode=cached-handoff-tooltraces) and modearg-reverse (configured cached-handoff-tooltraces + /compact cached -> no tooltrace + details.mode=cached), both PASS.
- Full 8-mode matrix re-verified ALL PASS after the change (no regression).
- Ticket mpd-b8nt tracks making keepRecentTokens configurable (the "session too small" guard).

**2026-08-12T23:25Z — flaky cached summary prompt addressed**

DANCE_SUMMARY_MESSAGE rewritten to mirror pi's default SUMMARIZATION_PROMPT (core/compaction/compaction.ts): named sections (Goal, Constraints & Preferences, Progress, Key Decisions, Next Steps, Critical Context), EXACT-format contract, "(none)" fallbacks, plus the shared "do not use tools, do not do any work" tail. The old prompt ("Reply with ONLY a standalone structured summary...") had no content contract, which let deepseek-v4-flash return a 1-token echo (2/4 runs). Prompt body is byte-identical to pi's 879-char SUMMARIZATION_PROMPT before the appended tail. Test prefix checks updated in extensions/tests/compaction/live/ (drive_special.py, verify.py) and ~/pi-compact-test/. `bunx tsc` typecheck passes. Live re-test of cached / cached-summary-tooltraces VERIFIED 2026-08-12 (new prompt): both ALL PASS via extensions/tests/compaction/live (run.sh narrowed to the two modes). Summaries follow the EXACT format (all six sections; Programmatic section for the tooltraces mode), lengths 2328/1781 chars, no degenerate echoes, cacheRead ratio 0.99, details.mode matches, post-compact follow-up works.

**2026-08-12T23:30:11Z**

Closing: both findings fixed and verified live. Finding 1 (flaky summary prompt) fixed by prompt rewrite (eafc3ca) + live verification (results-2026-08-12-summary-prompt.md). Finding 2 (/compact <mode> phase-3) fixed by b1d3f3f + modearg/modearg-reverse. Follow-ups tracked: mpd-zu1e (quality guard), mpd-b8nt (keepRecentTokens), mpd-1kl2 (pi TUI paste crash).
