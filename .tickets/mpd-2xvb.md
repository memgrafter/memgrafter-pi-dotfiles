---
id: mpd-2xvb
status: closed
deps: []
links: []
created: 2026-08-10T00:06:43Z
type: feature
priority: 3
assignee: memgrafter
---
# Add pre-round context length to round metrics

## Notes

**2026-08-10T00:06:43Z**

pi-prom-round: record preexisting context at round start. Use ctx.getContextUsage().tokens at agent_start (rounds.jsonl field contextTokensAtStart; .prom gauge pi_round_context_tokens_start). Optional: per-message total-context sample at each turn_start via getContextUsage(). Caveat: getContextUsage estimates tokens for trailing messages (last assistant usage + estimate), not provider-exact; only provider-reported usage is exact. Check exact return shape of getContextUsage() before implementing.

**2026-08-10T03:36:35Z**

DECLINED by user: context length via getContextUsage() is an estimate, not provider-exact; user scoped the feature set to real data only. Closed as wontfix unless a provider-exact source appears.
