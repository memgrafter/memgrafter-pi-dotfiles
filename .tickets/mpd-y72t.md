---
id: mpd-y72t
status: open
open: true
deps: []
links: []
created: 2026-09-06T01:13:02Z
type: feature
priority: 3
assignee: memgrafter
tags: [repl, replmux, ux]
---
# repl tool: spill large output to file like bash

The `repl` (replmux) tool has no output-size guard. Large outputs are truncated and return only 'No result provided' with no spill-to-file, unlike the bash tool which spills >20KB output to a temp file and points at it (see extensions/pi-bash-20kb.ts).

Observed: grepping a large minified .d.ts via the repl tool returned 'No result provided' and the content was lost, forcing a re-do with a narrower command.

Desired: give repl output the same treatment as bash — when output exceeds a threshold, write the full output to a temp file and return a short summary plus the file path, so nothing is silently lost.

Location: replmux extension (replTool.ts -> ../../replmux/pi/extension/replTool.ts). Mirror the logic/approach in extensions/pi-bash-20kb.ts.

Open: pick the threshold (match bash's 20KB?) and the exact message format.
