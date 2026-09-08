---
id: mpd-10jg
status: open
open: true
deps: []
links: []
created: 2026-09-06T04:46:42Z
type: investigation
priority: 2
assignee: memgrafter
---
# Investigate: models emit tool calls inside think tool output blocks; consider deferring tool calls until thinking completes (seen with Qwen 3.8 27B)

## Notes

**2026-09-06T04:46:52Z**

Qwen 3.8 27B observed putting tool calls in think tool output blocks. Hypothesis: model interleaves tool-call content with thinking. Possible fix: communicate tool calls to pi only after thinking completes, not mid-think.
