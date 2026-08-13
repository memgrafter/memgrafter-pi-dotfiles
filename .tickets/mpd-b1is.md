---
id: mpd-b1is
status: open
deps: []
links: []
created: 2026-08-11T21:37:36Z
type: chore
priority: 3
assignee: memgrafter
tags: [prompt, optimization, redundancy]
---
# Trim ~490 tok redundancy in frag-effective-system-prompt.txt

frag-effective-system-prompt.txt measures 3092 tokens (cl100k_base) / 3079 (o200k_base).

Trimmable redundancy found by tiktoken analysis:
1. AGENTS.md `## SKILLS` blurb (155 tok): names knowledge-registry, ticket-rs, tmux-orchestration — all fully described in <available_skills>.
2. AGENTS.md `## repl & repl-manage` blurb (43 tok): repeats repl/repl-manage semantics already in the tools list (104 tok).
3. XML markup in available_skills (235 tok): <skill>/<name>/<description>/<location> boilerplate = 22% of skills block.
4. tmux-orchestration covered twice: available_skills entry + AGENTS.md "Parallel Agent Orchestration" section.

Post-trim estimate: ~2600 tok (16% reduction).

Context impact: 37.7% of an 8k window, 18.9% of 16k. Negligible on 128k+.
Target: trim ~490 tokens without losing information; diff token counts before/after.
