---
id: mpd-g9t2
status: open
open: true
deps: []
links: []
created: 2026-09-06T21:35:45Z
type: chore
priority: 3
assignee: memgrafter
tags: [think-tool, review]
---
# think-tool.ts review: type hygiene, atomic write, docs, tests

Code review of extensions/think-tool.ts (2026-07-18). Overall quality is good; no broken behavior. Items, ranked:

1. Type hygiene — TDetails not captured. createThinkTool(): ToolDefinition leaves TDetails = unknown, so renderResult takes AgentToolResult<any> and casts content parts (c: any). Real result shape is { kind?, level?, reasoning }. Fix: use defineTool({...}) or annotate ToolDefinition<typeof thinkSchema, ThinkDetails>. Only place the file reaches for any.

2. Dead fallback in renderResult: colorFn || content — theme.fg always returns a string, so the fallback never fires. Drop it or keep deliberately as defense.

3. Non-atomic settings write. writeFileSync directly over the settings file; a crash mid-write corrupts JSON, which readJsonObject then silently treats as "setting absent" (parse errors swallowed). Temp-file + rename removes the failure mode in two lines.

4. Write-target heuristic is implicit. getSettingsPathToUpdate writes to project settings if the project file already has the section, else global. A user who deletes the project section to fall back to global will have /think-tool on recreate the project section instead of writing global. Add a one-line comment stating the rule (user approved this comment).

5. No tests. extensions/tests/ only covers compaction. Settings-resolution logic (precedence, corrupt JSON, section preservation) is pure and trivially testable — most worth pinning down.

6. Minor: renderCall emits one long line [think · kind: X · level: Y] <reasoning> with no truncation — fine if Text wraps, noted only.

Verified during review: no activation race — sdk.js builds initial active set from defaultTools ?? ["read","bash","edit","write"], extension tools are not auto-activated when an explicit list is passed, and session_start fires during bindExtensions before any prompt is processed, so think starts inactive and is activated by the handler cleanly.
