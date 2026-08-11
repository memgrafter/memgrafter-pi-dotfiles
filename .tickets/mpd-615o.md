---
id: mpd-615o
status: closed
deps: []
links: []
created: 2026-08-10T02:42:14Z
type: feature
priority: 2
assignee: memgrafter
---
# Seed pi-prom-round counters from existing .prom; fork gets fresh file

## Notes

**2026-08-10T02:42:14Z**

Continuity rule: .prom follows the session filename.
- Filename unchanged (reload, resume same session file, tree nav): on session_start, if a .prom exists for this basename, parse its pi_...{labels} value lines (skip HELP/TYPE), rebuild SessionCounters, seed in-memory counters. Rewrites continue monotonic. Fixes reload counter-reset (5->0->2) and process restart (pi --session <file>) resets.
- Filename changed (fork, clone, new): new .prom, fresh zeros. No inheritance, no double counting. Parent file keeps its totals; each round appears in exactly one file.
- Tree navigation: no-op (never re-emits session_start; filename unchanged).
- Fork lineage: rounds.jsonl records gain parentSession (+ lineage) fields for family reconstruction from the source of truth only; never sum .prom files across lineage.
- Duration gauge not affected (per-file).
- Parse failure -> zeros + console.error, never throw. New/fork sessions skip seeding.
Implement as seedCountersFromProm(basename) called in session_start.

**2026-08-10T03:01:36Z**

SUPERSEDED: per-session .prom dropped by design decision (no double count; session views via session file script or filtering the global rounds.jsonl). Seeding/resume logic no longer needed.
