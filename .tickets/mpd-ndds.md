---
id: mpd-ndds
status: closed
deps: []
links: []
created: 2026-08-10T03:01:36Z
type: feature
priority: 2
assignee: memgrafter
---
# Simplify pi-prom-round to append-only rounds.jsonl (drop per-session .prom)

## Notes

**2026-08-10T03:01:36Z**

Final shape: extension writes ONLY ~/.pi/agent/metrics/rounds.jsonl, one record per round at agent_settled. Remove .prom writer, SessionCounters, cumulative state, seeding, session_start hook, promLabel escaping of .prom labels (keep field escaping for JSON). Per-session views are out of scope: filter rounds.jsonl by sessionId, or read the session .jsonl via a script (that path includes per-message usage + compaction entries). Retain sessionId/ts/cwd/model/provider/usage/cost/stopReason/errorMessage/toolCalls/durationMs/runs fields. Keep appendFileSync single-writer-agnostic (POSIX atomic small appends).

**2026-08-10T03:01:36Z**

Still open regardless: (1) compaction/branch-summary usage not captured (compact() bypasses agent loop; fold session_compact.compactionEntry.usage into record), (2) crash mid-round loses the round (inherent), (3) field tickets mpd-7d8i (thinking level) + mpd-2xvb (context at round start) stand, (4) Prometheus ingestion from rounds.jsonl = next step, out of extension scope.

**2026-08-10T03:10:03Z**

IMPLEMENTED + TESTED. Extension rewritten: append-only rounds.jsonl, no .prom writer, no cumulative state. Tests (tmux, deepseek/deepseek-v4-flash): normal round w/ tool call, second round same session, Esc abort -> aborted + EMPTY_USAGE, accidental 400 -> error + errorMessage, 2 parallel agents -> shared file distinct sessionIds. Harness gotchas documented in WIP doc: single-call C-m for shell boot, Enter for TUI submit, kill stale pi procs before runs.
