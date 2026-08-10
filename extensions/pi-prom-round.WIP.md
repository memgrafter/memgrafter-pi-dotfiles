# pi-prom-round — WIP decisions

Status: design settled as **append-only `rounds.jsonl`** (per-session `.prom` dropped). MVP code still writes the old dual artifact — implementation of this decision pending (ticket mpd-ndds).

## Goal

Emit Prometheus-style metrics per agent **round** from a pi extension. Zero
dependencies, no server, works across many asynchronous sessions that can be
forked, resumed, restarted, or killed at any point.

## Final design (decided)

The extension writes **exactly one thing**: append one JSON record per completed
round to `~/.pi/agent/metrics/rounds.jsonl`.

- No per-session `.prom` files, no cumulative counters, no in-memory session
  state, no seeding, no `session_start` hook, no lineage logic.
- **Per-session views are out of scope**: filter `rounds.jsonl` by `sessionId`
  (`jq 'select(.sessionId=="<id>")'`), or read the session `.jsonl` directly via
  a script (that path has per-message usage + compaction entries — more complete
  but separate tooling).
- **Prometheus ingestion is the next step** (out of extension scope): a
  watcher/aggregator converts `rounds.jsonl` into scrape/push metrics. The
  record fields below are the contract for that.

Why the per-session `.prom` was dropped: it forced a choice between continuity
(resume/seed, fork double-counting) and correctness (no double count). Deriving
session totals from the session file (what pi's own footer does) is complete but
not summable across files; seeding was stateful and fragile. Appending rounds to
one global log sidesteps all of it — the log is the source of truth, everything
else is a projection.

## What "round" means (researched from pi-mono source)

- One user prompt = one agent run: `agent_start` -> N x (`turn_start` ->
  `turn_end`) -> `agent_end` -> `agent_settled`.
- **`agent_end` fires early** — before auto-retry, auto-compact+retry, or queued
  follow-up messages. `agent_settled` fires once at the true end of the round.
  => Round = interval between `agent_settled` events. Append there, reset there.
- **Retries are separate runs**: `_runAgentPrompt` loops
  `agent.prompt()` -> `while (_handlePostAgentRun()) agent.continue()`; the
  agent loop re-emits `agent_start`/`agent_end` per prompt *and* per continue.
  So retries/compaction-continuations appear as extra `agent_start` cycles
  inside the same round. Counting `agent_start` between settlements gives a
  `runs` number; `runs - 1` approximates retries + continuations.
- **Failed/aborted turns still emit events**: any throw (stream error, provider
  5xx, user Esc) becomes a synthetic assistant message with
  `stopReason: "error" | "aborted"`, `errorMessage`, and **`usage: EMPTY_USAGE`
  (all zeros)** (`handleRunFailure` in `packages/agent/src/agent.ts`). It goes
  through the normal `message_start/end`, `turn_end`, `agent_end` stream. The
  extension folds it in with zero tokens and the error stop reason — no
  special-casing needed, but see limitation 1 below.
- **Extensions cannot see** `auto_retry_start/end` or `agent_end.willRetry`
  (internal events only). Retry visibility is approximated via `runs`.

## Round record (contract for ingestion)

ts, sessionId, sessionFile basename, cwd, provider, model, models (unique list,
model_select / per-message), thinkingLevel (round start, updated on
thinking_level_select), durationMs, runs, turnCount, turns (per-turn
latencyMs + usage), toolCalls, tools (per-tool calls/errors/durationMs),
stopReason, errorMessage, usage sums, cost sums, kind ("round" |
"compaction" | "branch_summary").

Accumulation happens on `turn_end` (assistant messages only) + tool
lifecycle events. `agent_start` initializes/activates the round;
`session_shutdown` flushes a mid-flight round as `stopReason: "interrupted"`
(safety net — normally `agent_settled` fires even on abort because
`_runAgentPrompt` has `finally { _emitAgentSettled() }`).

Compaction usage is folded into an active round; standalone compaction and
branch-summary model calls (which happen outside agent rounds — tree nav
requires idle, and /compact can run anytime) are emitted as their own records
with `kind` set, so every model call is accounted for.

## Concurrency (60+ sessions, processes not always active)

- Every process appends to the one shared `rounds.jsonl`;
  `appendFileSync` on POSIX is atomic for small lines (O_APPEND) — no locking,
  no corruption. Each line ~1KB.
- Each record is self-contained (sessionId + ts), so interleaved appends from
  many processes are fine.
- Dead/idle processes leave no residue — the log is append-only, nothing to
  clean except the file itself over time.

## Failure-safety

- Every handler body is wrapped in try/catch with `console.error` — a throwing
  extension handler would propagate into the agent loop and break the run.
- Single sync append per round; mkdir recursive on first use.

## Bugs found during testing

- **Print mode returns an absolute `getSessionFile()`**: in `-p` mode (ephemeral
  session) `ctx.sessionManager.getSessionFile()` returns the full path, not the
  basename. `sessionFile` in the record must be the basename — strip via
  `split("/").pop()` before writing (was a `.prom` path bug pre-simplification;
  still matters for the record field).

## Test-harness finding (tmux, not extension code)

- **`C-m` does NOT submit in the pi TUI on this setup; the `Enter` key name
  works** (tmux `extended-keys` is ON). This is the opposite of the repo
  AGENTS.md guidance. Send prompt text and `Enter` as two separate
  `tmux send-keys` calls. Worth correcting in AGENTS.md (left untouched here —
  dirty from another worker).

## Known limitations / open questions

1. **Token accounting on failed streams is understated by design**: failure
   messages hardcode `EMPTY_USAGE`, so tokens consumed before a stream dies are
   not counted. Only fixable provider-side; the extension cannot recover them.
2. **Crash mid-round loses the round** (no `agent_settled` line ever written) —
   inherent to append-on-settle; acceptable. Session-file-derived views recover
   partial messages if `message_end` persisted before the crash.
3. **Crash mid-round loses the round** (no `agent_settled` line ever written) —
   inherent to append-on-settle; acceptable. Session-file-derived views recover
   partial messages if `message_end` persisted before the crash.
4. **Follow-up/steer messages**: each queued follow-up runs its own
   `_runAgentPrompt` and gets its own `agent_settled` => counted as a separate
   round. Arguably correct (it is a separate prompt).
5. **`runs` is a proxy for retries** — it also counts compaction continuations.
   Label is honest (`runs`), not `retries`.
6. **Pre-installation history absent from `rounds.jsonl`** — rounds before the
   extension existed are only in session files. Ingestion from the session file
   (via script) is the recovery path.
7. **Growth**: `rounds.jsonl` grows unboundedly (~1KB/round). Rotation is an
   ingestion-side concern (like any log).

## Tickets

- mpd-ndds [closed] — simplify extension to append-only rounds.jsonl.
- mpd-7d8i [P3, open] — add thinking level to round record. IMPLEMENTED in this
  round (thinkingLevel at agent_start + thinking_level_select updates); ticket
  covers verification/review.
- mpd-2xvb [P3, open] — add context length at round start
  (`ctx.getContextUsage().tokens`; estimate, not provider-exact). Deliberately
  NOT implemented — user scoped to real data only.
- Round-record completeness (this round's work, no ticket): compaction/
  branch-summary usage capture, models list, per-turn usage/latency, tool-level
  breakdown. Runtime-tested in tmux.

## Test plan / results (all five real-data features)

Manual tmux test with deepseek provider, `deepseek-v4-flash` model.

- [x] Normal round (with tool calls): turnCount, per-turn latencyMs + usage, per-tool breakdown (`tools: {bash: {calls, errors, durationMs}}`), thinkingLevel, models list.
- [x] Multi-turn round: turns latencies per LLM call (e.g. 3 turns: [2468, 1563, 1385]ms), toolCalls 2, bash durationMs summed.
- [x] Compaction: `/compact` produced a standalone `kind: "compaction"` record with the summarization call's usage (451 tokens) when idle. (Triggered by temporarily lowering `compaction.keepRecentTokens` to 1000 in settings; restored after. Default manual /compact refuses small sessions: "Nothing to compact (session too small)" below the keep-recent floor.)
- [x] Abort test (Esc mid-stream): record with `stopReason: "aborted"`, `errorMessage: "Operation aborted"`, zero usage (EMPTY_USAGE path confirmed).
- [x] Provider error path: earlier accidental 400 captured as `stopReason: "error"` + errorMessage + zero usage.
- [x] Parallel agents (pre-simplification suite): shared rounds.jsonl, distinct sessionIds.

### tmux harness gotchas (cost most of the test time)

- Shell boot: send command + `C-m` in a SINGLE `tmux send-keys` call. Splitting text and Enter/C-m into two calls intermittently loses the newline, and the next typed text then appends to the shell line — mangling the `--model` flag ("deepseek-v4-flashUse").
- pi TUI prompt submission: two calls (text, then `Enter` key name) — the inverse of the shell.
- Multiple stale pi processes from aborted attempts keep writing to the shared rounds.jsonl; always `pkill -f 'pi -e <ext>'` and verify zero processes before a clean run.
- Settings key is `compaction`, not `compact`; manual /compact needs context above the keep-recent-tokens floor.
