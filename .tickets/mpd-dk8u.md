---
id: mpd-dk8u
status: deferred
open: true
deps: []
links: []
created: 2026-09-08T20:27:16Z
type: feature
priority: 1
assignee: memgrafter
tags: [frag, models]
---
# Model-driven frag role (fragRole in models.json)

Model-driven frag role: auto-apply a frag role from a `fragRole` property on model entries in ~/.pi/agent/models.json.

## Context
- The `instruct` role (coding agent + repl/think/reasoning-skill guidelines) should be active by default on instruct models.
- Role is currently NOT sticky across new sessions: session_start else-branch hardcodes DEFAULT_ROLE_ID (coding-agent). Role only survives via per-session frag-mode entry (resume) or launch flag (--instruct).
- models.json is schema-validated (TypeBox) but extra keys pass through (no additionalProperties:false; `wireModel` already used on modal models).
- pi's toModel() in provider-composer.js DROPS unknown keys, so ctx.model will NOT carry fragRole — the extension must read models.json itself and match on ctx.model.provider + ctx.model.id.
- ctx.model is available on session_start ctx. before_agent_start event has NO model field. model_select event fires on mid-session model switch (source: set|cycle|restore).
- Role dedup on resume already works: scanLastInjectedRole + lastInjectedRole guard in before_agent_start.

## Plan (agreed with user)
1. loadModelFragRole(model) helper: read join(getAgentDir(), "models.json"), find providers[model.provider].models[].id === model.id, return entry.fragRole if it is a valid registered role id. Never throws (missing/invalid file -> undefined).
2. session_start new-session else-branch (no persisted entry, no launch flag): after state.role = DEFAULT_ROLE_ID, if state.enabled && ctx.model: apply loadModelFragRole(ctx.model) when present.
   Precedence (high->low): persisted session entry > launch flag > models.json fragRole > coding-agent default.
3. pi.on("model_select"): if !state.enabled return; modelRole = loadModelFragRole(event.model); if !modelRole or === state.role return (no fragRole -> keep current, no surprise revert); if session has an explicit persisted role differing from modelRole, keep explicit + notify; else state.role = modelRole, persistState(), updateStatus(). Role message auto-injects via existing before_agent_start guard (no cache bust).
4. Docs: README.md, extensions/README.md, file header comment — document fragRole property + precedence.

## models.json example
{ "id": "some-model", "name": "...", "fragRole": "instruct" }

## Out of scope (separate decision, user deferred)
- Part 5: persist last explicit /frag set role into settings.json frag key so it sticks for new sessions on ANY model (not just models with fragRole).

## Notes

**2026-09-08T20:27:40Z**

Deferred: approach not decided. We may not add this feature via a models.json fragRole property — the plan in the description is a proposal only, not a commitment.
