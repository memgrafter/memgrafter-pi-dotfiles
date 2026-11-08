---
id: mpd-kb4y
status: open
open: true
deps: []
links: []
created: 2026-11-08T20:27:44Z
type: task
priority: 1
assignee: memgrafter
tags: [skills, claude-code]
---
# Make skills session-conditional: global skills are an antipattern

Owner (2026-11-08): skills must load only in the sessions that need them. Loading every skill globally is an antipattern.

Current setup:
- ~/.claude/skills is a symlink to ~/code/memgrafter-pi-dotfiles/skills, so every skill there is listed in EVERY Claude Code session.
- Each listed skill costs its '- name: description' line in context: about 1,570 tokens for the 26 loadable skills (estimate at 4/3 tokens per word, measured 2026-11-08).
- 10 project skills were moved here from ~/code/characteragent.ai-social-content/.claude/skills on 2026-11-08 (commit 28c4f2b here, c64cc9f6 there): camera-composition, deliver, h3-capabilities, h3-experimental, h3-takes, keyframe, short-draft, stitch, take-read, voice-line. They add about 770 tokens to every session but are only useful for characteragent / H3 work.
- Those skills give paths relative to the characteragent repo (production/h3/...), so they break when used from another folder.
- 8 entries are broken symlinks to /Users/trentrobbins/... (coding-tools, external, flatmachine-manager, knowledge-registry, manual, openai-deep-research-citation-fixer, quick-report, quick-report-skill). They load nothing on this Mac.
- Four characteragent docs now point at the global location: AGENTS.md:25, docs/H3_OWNER_GUIDE.md:3, docs/H3_TECHNIQUES.md:5, production/h3/README.md:8.

To decide:
- the mechanism: per-project .claude/skills (symlinks or copies), a per-session skill set (e.g. launcher aliases or CLAUDE_CONFIG_DIR profiles), or pi skill-injector rules;
- which skills stay global (if any);
- where the characteragent skills live (back in that repo, or here with a per-project link);
- whether to fix their repo-relative paths.
