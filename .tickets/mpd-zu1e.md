---
id: mpd-zu1e
status: open
deps: []
links: [mpd-sr7t]
created: 2026-08-12T23:30:05Z
type: task
priority: 3
assignee: memgrafter
tags: [compaction, extension]
---
# Quality guard on captured dance summary

Defense-in-depth for the cached dance summary (Finding 1, mpd-sr7t).

The DANCE_SUMMARY_MESSAGE rewrite (eafc3ca) fixed the observed flakiness on deepseek-v4-flash: live runs now produce full EXACT-format summaries (2328/1781 chars, all sections, cacheRead 0.99). What remains: there is still no quality guard on the captured summary reply.

`message_end` captures any non-empty assistant text verbatim into danceState.summary; phase 3 commits it as the compaction content. If a model regresses to a 1-token degenerate echo (e.g. "ACK"), compaction succeeds with garbage.

Proposed: in `message_end`/phase 3, reject captured summaries that are too short (e.g. < 100 chars) or lack the section structure; retry once with the same prompt; if the retry also fails, fail with the existing "Compaction summary failed" notify and clear danceState (no compaction). Consider a minimum-length floor aligned with pi's own summarizer expectations.

Files: extensions/pi-compaction-modes.ts (message_end + session_before_compact captured branch). Verification: rerun cached + cached-summary-tooltraces live scenarios (verify.py) plus a forced-degenerate case.
