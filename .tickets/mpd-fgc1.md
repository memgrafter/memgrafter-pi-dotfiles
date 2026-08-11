---
id: mpd-fgc1
status: open
deps: []
links: []
created: 2026-08-10T05:43:18Z
type: task
priority: 3
assignee: memgrafter
---
# Crashed rounds: no summary record; recovery via session file (no extension change)

## Notes

**2026-08-10T05:43:18Z**

Context: pi-prom-round extension (this repo) appends one summary record to ~/.pi/agent/metrics/rounds.jsonl at agent_settled (the true end of a round; fires even on abort, in _runAgentPrompt finally). A hard process crash mid-round means agent_settled never fires, so no summary record is written for that round.

Data loss assessment: NONE in the underlying data. pi appends every message to the session file on message_end, before agent_settled (agent-session.ts). A crash loses only the derived summary in rounds.jsonl; all completed messages with their usage survive in the session file.

Decision: no extension change (no checkpoint/partial records). Checkpointing would duplicate data already durably persisted in the session file, adding settled:false noise and extra writes for no recovery gain.

Recovery path (ingestion-side, out of extension scope): reconstruct a crashed round from the session file by summing assistant-message usage; detect crashed rounds as session-file content after the last settled rounds.jsonl record for that sessionId. This is a job for the rounds.jsonl ingestion/backfill tooling, not the extension.

Caveat: usage for failed/aborted turns inside that reconstruction is zeroed (see the upstream EMPTY_USAGE issue mpd-05z9) — the session file inherits the same limitation.
