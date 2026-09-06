---
id: mpd-44ua
status: open
open: true
deps: []
links: []
created: 2026-09-06T01:52:25Z
type: feature
priority: 2
assignee: memgrafter
tags: [think, settings, model, planning]
---
# Per-model persistent tool setting for think tool

Plan (not implement) a per-model persistent tool setting so the think tool auto-enables at session start only on instruct models; tradeoff is cache bust on model switch, or scope it to session start so a session keeps the tool it started with unless changed via the /think-tool slash command.
