---
id: mpd-05z9
status: open
open: true
deps: []
links: []
created: 2026-08-10T05:43:13Z
type: bug
priority: 2
assignee: memgrafter
---
# [upstream pi-mono] handleRunFailure drops provider-reported usage on failed/aborted streams

## Notes

**2026-08-10T05:43:13Z**

Context: pi-prom-round extension (this repo) records per-round token usage from assistant message usage. It cannot recover usage for failed or user-aborted turns because pi-mono discards it.

Where: packages/agent/src/agent.ts, handleRunFailure(error, aborted). On ANY throw in the agent run (stream error, provider 5xx, user Esc), it constructs a synthetic assistant message with usage: EMPTY_USAGE (all zeros) and stopReason "error" | "aborted", then emits message_start/message_end/turn_end/agent_end. The zeroed usage is also persisted to the session file (message_end append), so the loss is permanent everywhere.

The thrown error / partially-consumed stream may carry real usage the provider reported (incremental stream usage, or usage in error bodies). handleRunFailure never inspects it.

Impact: token and cost accounting understates failed rounds. For providers that report usage only in the final stream chunk (OpenAI/DeepSeek style), an abort before that chunk genuinely has no usage available; for providers that stream usage incrementally, real data is being thrown away.

Requested fix (upstream): in handleRunFailure, if the error/partial stream carries usage, put it on the failure message instead of EMPTY_USAGE. Extension and session-file consumers then get it for free via the existing turn_end/message_end path.

Extension-side stance until fixed: failed rounds stay flagged (stopReason error/aborted) and should be marked/excluded from cost sums at ingestion, not treated as exact zeros.
