# Compaction live-test results

Run date: 2026-08-12 (16:18 local). Provider: deepseek / deepseek-v4-flash, thinking off.
Extension: `extensions/pi-compaction-modes.ts` @ commits eafc3ca (summary prompt rewrite) + b1d3f3f (phase-3 mode fix).
Harness: `run.sh` narrowed to the two modes that use `DANCE_SUMMARY_MESSAGE` (`cached`, `cached-summary-tooltraces`).
Raw artifacts (session JSONLs, driver logs): `runs/<mode>/` (gitignored).

## cached

- details.mode: `cached`
- tokensBefore: 32643
- firstKeptEntryId: `__pi_compaction_modes_keep_none__`
- summary length: 2328 chars
- section headers: ## Goal, ## Constraints & Preferences, ## Progress, ### Done, ### In Progress, ### Blocked, ## Key Decisions, ## Next Steps, ## Critical Context
- degenerate echo (summary <= 20 chars): False
- summary-turn cacheRead: 31744 / input 331 (ratio 0.99)

### Compaction summary content

```
## Goal
This is a test-driver harness sequence for a compaction test. Each message commands a specific, atomic action (write haiku, list dir, echo filler text) and verifies the agent responds with an exact expected token. The current session is a context-checkpoint/continuity test — the agent (this LLM) must produce a structured checkpoint summary another LLM can use to continue.

## Constraints & Preferences
- Reply formats must match the exact token requested in each prompt (e.g., only the haiku, exactly `DONE`, exactly `FILLER_OK`).
- For this final message: produce the structured checkpoint summary using the EXACT format header block provided (## Goal, ## Constraints & Preferences, ## Progress, ## Key Decisions, ## Next Steps, ## Critical Context).
- Do not use tools; do not do any work.
- Coding-harness agent guidelines apply (AGENTS.md: concise, no build commands, timeouts on waits, etc.) but the current task is pure summarization.

## Progress
### Done
- [x] Responded to a "write a haiku about caching" prompt with only a haiku.
- [x] Ran `ls -la /Users/trentrobbins/code/memgrafter-pi-dotfiles/extensions/tests/compaction/live/runs/cached` and replied exactly `DONE`.
- [x] Read the filler-text payload and replied exactly `FILLER_OK`.

### In Progress
- [ ] Producing this structured checkpoint summary (the current message).

### Blocked
- None.

## Key Decisions
- **Reduce each prompt to its minimal required exact string**: The harness tests exact-token compliance, so no extra prose was added.
- **Run the ls command in the specified directory before replying**: Tool call must precede the `DONE` echo.

## Next Steps
1. A future LLM (or harness step) should continue this compaction/continuity test sequence as directed by the next message.
2. Maintain exact-token reply discipline in subsequent prompts.
3. If the test resumes on the actual compaction logic, inspect `test/driver` harness outputs in the `cached` run directory.

## Critical Context
- Directory listing of `/Users/trentrobbins/code/memgrafter-pi-dotfiles/extensions/tests/compaction/live/runs/cached` (from `ls -la`):
  - `.` (dir), `..` (dir), `.pi` (dir), `driver.log` (263 bytes), `driver.out` (263 bytes), `sessions` (dir).
- This session is agent-side bookkeeping/token-compliance testing, not the actual compaction algorithm.
```

## cached-summary-tooltraces

- details.mode: `cached-summary-tooltraces`
- tokensBefore: 32633
- firstKeptEntryId: `__pi_compaction_modes_keep_none__`
- summary length: 1836 chars
- section headers: ## Goal, ## Constraints & Preferences, ## Progress, ### Done, ### In Progress, ### Blocked, ## Key Decisions, ## Next Steps, ## Critical Context, ## Ordered Tool Trace
- degenerate echo (summary <= 20 chars): False
- summary-turn cacheRead: 31872 / input 216 (ratio 0.99)

### Compaction summary content

```
## Goal
Produce a structured context checkpoint summary of the preceding session (a compaction/live test harness exchange in `/Users/trentrobbins/code/memgrafter-pi-dotfiles/extensions/tests/compaction/live/runs/cached-summary-tooltraces`).

## Constraints & Preferences
- Response format: exact structured summary with the specified sections.
- Do not use tools; do not do any work.

## Progress
### Done
- [x] Generated a haiku about caching.
- [x] Ran `ls -la /Users/trentrobbins/code/memgrafter-pi-dotfiles/extensions/tests/compaction/live/runs/cached-summary-tooltraces` — output confirms the run directory exists, containing: `.pi/` (dir), `driver.log`, `driver.out`, and `sessions/` (dir), each with modification timestamps of Aug 12 15:50/16:18.
- [x] Acknowledged context filler text with the exact token `FILLER_OK`.

### In Progress
- [ ] (none)

### Blocked
- (none)

## Key Decisions
- **Requested ls of the run directory**: This task is part of a live compaction test (`cached-summary-tooltraces`), likely to verify tool-use caching behavior under compaction.
- **Filler token convention**: `FILLER_OK` used as a marker for the test harness.

## Next Steps
1. Produce the context checkpoint summary in the exact required format.

## Critical Context
- Working directory: `/Users/trentrobbins/code/memgrafter-pi-dotfiles/extensions/tests/compaction/live/runs/cached-summary-tooltraces`
- `ls -la` output for the run directory:
  - `drwxr-xr-x@` `.` (Aug 12 16:18)
  - `drwxr-xr-x@` `..` (Aug 12 15:50)
  - `drwxr-xr-x@` `.pi` (Aug 12 16:18)
  - `-rw-r--r--@` `driver.log` (396 bytes, Aug 12 16:18)
  - `-rw-r--r--@` `driver.out` (396 bytes, Aug 12 16:18)
  - `drwxr-xr-x@` `sessions` (Aug 12 16:18)
- This checkpoint summary is itself the deliverable for this session.

# Programmatic

## Ordered Tool Trace
- bash ls -la .
```
