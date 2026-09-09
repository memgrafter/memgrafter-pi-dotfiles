---
id: mpd-oe5a
status: closed
open: false
deps: []
links: []
created: 2026-09-09T15:43:32Z
type: feature
priority: 1
assignee: memgrafter
tags: [skill, compaction]
---
# Skill injector: keep named skills in context across launch and compaction

New extension extensions/skill-injector.ts. Config: "skill-inject": {enabled, skills: [names]} in .pi/settings.json (project -> global). Injects each named skill's expanded <skill> block (same format as /skill:name) as a custom message via before_agent_start, after the user message and after the frag role message. Injects at launch (first prompt) and re-injects after every session_compact. /skill-inject status|on|off|add|remove|list. No system prompt changes, so no cache-bust flow.

## Notes

**2026-09-09T15:47:34Z**

Implemented: extensions/skill-injector.ts (new) + extensions/README.md entry. before_agent_start injects one combined custom message (customType skill-inject) with /skill:name-format blocks for all configured skills; session_compact resets the injected flag; /skill-inject status|on|off|add|remove|list; settings key "skill-inject" {enabled, skills:[names]}. NOT committed: working tree also has another agent's uncommitted changes to extensions/flexible-role-agent.ts (instruct label -> instruct-coding) which I did not touch.

**2026-09-09T15:55:48Z**

Fixed 0.85.1 crash: event contexts lack getSystemPromptOptions (command contexts only). Now captures the skill registry from before_agent_start event.systemPromptOptions into a snapshot (refreshed on session_start/reload via pendingRefresh); commands use ctx.getSystemPromptOptions with snapshot fallback. Committed c9a5f22. Also cleaned up stray homebrew pi installs (0.85.1 npm global + May 2 0.72.1 @mariozechner).

**2026-09-09T16:04:02Z**

Resume guard + multi-source capture (52a2d3b): injected is now string[]|undefined. scanInjectedSkills reverse-walks session entries for skill-inject custom messages (details.skills fast path) AND user messages containing <skill name=...> blocks (typed /skill:name by user or agent). session_start scans (resume guard); session_compact/add/on set undefined -> rescan next prompt; before_agent_start injects only missing names. Known false-positive: model prose quoting a <skill name= header counts as present.

**2026-09-09T16:56:27Z**

All verifications pass: compact->prompt re-injection works (8656991), Markdown renderer no crash (e96445f), resume guard suppresses duplicate, manual /skill: dedup confirmed (injector does not re-fire after manual skill). Known limitation: pi /skill: command itself does not deduplicate against existing context (upstream pi behavior, not extension). Closing.
