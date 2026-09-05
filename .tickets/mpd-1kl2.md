---
id: mpd-1kl2
status: open
open: true
deps: []
links: [mpd-sr7t]
created: 2026-08-12T23:30:05Z
type: bug
priority: 3
assignee: memgrafter
tags: [pi, tui]
---
# pi TUI crashes on large paste (>250KB)

pi TUI crashes on large pastes (FINDING 3 from mpd-sr7t campaign).

Observed: a single ~1.05MB tmux paste-buffer paste into the pi TUI crashes the process (exits to shell). Pastes >250KB stream slowly; chunked pastes (~132KB) with end markers are reliable. 1.05MB via piped stdin (--print) works.

pi-level issue, not the compaction extension. Workaround documented in the harness (chunked pastes). Revisit if the paste path matters (e.g. large context seeding, big file insertions).
