---
id: mpd-31rn
status: open
open: true
deps: []
links: []
created: 2026-08-16T21:14:28Z
type: bug
priority: 1
assignee: memgrafter
---
# frag: role not re-asserted on new branch after tree-back past a role message

## Notes

**2026-08-16T21:14:45Z**

Scope: extensions/flexible-role-agent.ts

Symptom (as reported; user notes the recollection may be imperfect — REPRO FIRST, do not fix from this description alone):
After a frag role has been sent but the turn was either aborted or never reached a chat, treeing back to an earlier message and sending a new prompt on the new branch does NOT re-assert the role. The model then acts as a general-purpose assistant (per the context-builder framing: "Until a role message arrives, act as a general-purpose assistant").

**2026-08-16T21:14:45Z**

Suspected mechanism (verify during repro):
- scanLastInjectedRole() scans sessionManager.getEntries(), which returns ALL entries in the session file across every branch (session-manager.d.ts: "Branching moves the leaf to an earlier entry ... Existing entries" remain).
- lastInjectedRole is set from that flat scan at session_start and only updated on injection; it is NOT recomputed when the leaf moves via tree-back (branch(branchFromId)).
- The new branch's actual context path is leaf->root (buildContextEntries(entries, leafId), which also handles compaction) and does NOT contain the role message left on the abandoned path.
- But in before_agent_start, state.role === lastInjectedRole still holds, so the `state.role !== lastInjectedRole` gate suppresses re-injection -> new branch sends no [role: <id>] message at all.

**2026-08-16T21:14:45Z**

Repro plan (confirm each step actually behaves as described before fixing):
1. pi -e ./extensions/flexible-role-agent.ts --frag, then /frag set pkm (non-default role so absence is visible).
2. Variant A (aborted turn): send one prompt so the [role: pkm] message is injected; abort mid-generation.
3. Variant B (never got to a chat): /frag set pkm in a session where no turn has run yet after the set, or tree back before any post-role turn completed.
4. Tree back to a message BEFORE the role message (TUI tree navigation).
5. Send a new prompt on the new branch.
6. Expected: [role: pkm] re-injected in the new branch. Suspected actual: no role message; agent behaves as general-purpose assistant.
7. Also test the resume/restart variant after treeing back (session_start rescan picks the role up from the abandoned branch).

**2026-08-16T21:14:45Z**

Fix direction (post-repro, not yet decided):
- Scan only the current leaf->root path instead of all entries: buildContextEntries is exported from @mariozechner/pi-coding-agent and already handles compaction/branch summaries along the path.
- And/or recompute lastInjectedRole whenever the leaf moves (tree-back / branch), not just at session_start.
- Keep in mind: re-injection must stay idempotent on the SAME path (no duplicate role message when resuming a branch that already has one).
