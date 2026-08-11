---
id: mpd-3mgy
status: closed
deps: []
links: []
created: 2026-08-09T23:39:02Z
type: feature
priority: 2
assignee: memgrafter
---
# prom-round extension MVP: per-round prom metrics

## Notes

**2026-08-09T23:45:38Z**

MVP done and manually tested. Files: extensions/pi-prom-round.ts + pi-prom-round.WIP.md. Tests: normal round w/ tool call, cumulative counters, 2 parallel agents (separate .prom, shared rounds.jsonl), Esc abort -> stopReason aborted + EMPTY_USAGE. Bugs found/fixed: absolute session path in join() (print mode). tmux note: C-m does NOT submit in pi TUI here; Enter key name works (extended-keys on).
