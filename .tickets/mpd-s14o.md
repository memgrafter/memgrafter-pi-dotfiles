---
id: mpd-s14o
status: closed
open: false
deps: []
links: []
created: 2026-09-08T20:59:04Z
type: task
priority: 1
assignee: memgrafter
---
# Reinject frag role after compaction

After context compaction, the frag role's role message is lost from the conversation. Reinject the frag role after compaction so the agent continues operating under the correct role.

## Notes

**2026-09-08T21:11:44Z**

Implemented: added pi.on("session_compact") handler in extensions/flexible-role-agent.ts that resets lastInjectedRole to undefined. The existing before_agent_start path then re-injects the active role on the next turn after compaction. Not committed (other dirty files belong to other agents).
