---
id: mpd-7d8i
status: closed
open: false
deps: []
links: []
created: 2026-08-10T00:06:43Z
type: feature
priority: 3
assignee: memgrafter
---
# Add thinking level to round metrics

## Notes

**2026-08-10T00:06:43Z**

pi-prom-round: capture ctx.thinkingLevel at agent_start into the round record (rounds.jsonl field thinkingLevel) and as a label/gauge in the .prom. Caveat: level can change mid-round via model_select / thinking_level_select events; decide whether to also record changes (thinking_level_select event carries level/previousLevel) or just the round-start value. Model: deepseek-v4-flash reports reasoning tokens already; thinking level is the configured budget level, distinct from reasoning usage.

**2026-08-10T03:36:35Z**

IMPLEMENTED: thinkingLevel captured at agent_start from ctx.thinkingLevel, updated on thinking_level_select. Verified in tmux test (medium).
