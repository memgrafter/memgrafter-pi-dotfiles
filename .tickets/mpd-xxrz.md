---
id: mpd-xxrz
status: closed
open: false
deps: []
links: []
created: 2026-09-06T01:11:39Z
type: feature
priority: 2
assignee: memgrafter
tags: [think, extension, settings, command]
---
# Make think tool configurable via settings + /think-tool command

Make the `think` scratchpad tool (extensions/think-tool.ts) configurable via settings and a slash command.

Current state:
- Tool is registered unconditionally; activation is gated only by a CLI flag `think_tool` (default false), read once at session_start.
- No settings.json integration, no slash command.

Desired:
1. Settings: a `think_tool` boolean in a per-extension settings section. Resolution order: project .pi/settings.json, then global ~/.pi/agent/settings.json, then default OFF (false). Follow the pi-compaction-modes.ts / pi-idle-compact.ts pattern (readJsonObject, getProjectSettingsPath/getGlobalSettingsPath, section key).
2. Command: `/think-tool` with subcommands:
   - bare `/think-tool`  -> show current status (on/off + which source set it)
   - `/think-tool on`    -> enable (activate tool now + persist to settings)
   - `/think-tool off`   -> disable (deactivate tool now + persist to settings)
   - `/think-tool status`-> same as bare
   Use pi.registerCommand(name, { description, getArgumentCompletions?, handler: async (args, ctx) }). Activation via pi.getActiveTools()/pi.setActiveTools([...]) at runtime (additive for on; for off, drop "think" from the active set).
3. On session_start: resolve settings (default off) and activate/deactivate accordingly. Keep CLI flag as an override if present.

Prior art to mirror: extensions/pi-compaction-modes.ts (settings read/write + /compact command with set subcommand), extensions/pi-idle-compact.ts (enabled gate + settings section).

Open questions to confirm with user:
- Settings section key name: "think-tool" vs "think_tool"? (existing sections use kebab like pi-idle-compact; the CLI flag is think_tool). Pick one and note it.
- Should `off` persist, or only toggle for the session?
- Does the user want the CLI flag kept at all, or fully replaced by settings + command?

## Notes

**2026-09-06T01:13:06Z**

Decisions locked: /think-tool on|off persist to settings (project .pi/settings.json -> global ~/.pi/agent/settings.json -> default off). CLI flag --think_tool is a one-off idempotent session-only enable and does NOT write settings. Separate ticket mpd-y72t filed for repl output spill.

**2026-09-06T01:16:16Z**

Implemented in extensions/think-tool.ts: settings section 'think-tool' (key think_tool) resolved project->global->default(off); /think-tool [on|off|status] command (on/off persist to settings via getSettingsPathToUpdate, and activate/deactivate via setActiveTools); --think_tool flag is a one-off session-only OR into session_start activation and never writes settings. Verified via jiti load + command-handler tests covering project/global/default/flag/bad-arg.

**2026-09-06T01:53:28Z**

Done: implemented, committed (192e039), pushed, and user-verified (sticky setting, dynamic activation). Closing.
