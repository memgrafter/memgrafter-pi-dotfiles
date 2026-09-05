---
id: mpd-cod0
status: open
open: true
deps: []
links: [mpd-sr7t]
created: 2026-08-14T13:36:21Z
type: task
priority: 2
assignee: memgrafter
tags: [compaction, testing]
---
# Full 8-mode compaction matrix rerun (post prompt rewrite)

Full 8-mode compaction matrix rerun after the DANCE_SUMMARY_MESSAGE rewrite (eafc3ca).

Only cached and cached-summary-tooltraces use the rewritten prompt; both were live-verified individually (results-2026-08-12-summary-prompt.md, ALL PASS, cacheRead 0.99). The other 6 modes were last verified in the b1d3f3f matrix run (pre-prompt-change) — unaffected by the prompt rewrite but not rerun since.

Run: extensions/tests/compaction/live/run.sh (8 parallel pi sessions, deepseek-v4-flash), then verify.py for each mode. All 8 must be ALL PASS. Optionally re-run modearg/modearg-reverse and threshold/escabort specials afterward.
