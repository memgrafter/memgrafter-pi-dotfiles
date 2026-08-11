---
id: mpd-mh7l
status: open
deps: []
links: []
created: 2026-08-11T13:44:15Z
type: chore
priority: 3
assignee: memgrafter
tags: [metrics, pricing]
---
# Price remaining unpriced providers (9router, nano-gpt-qwen, gemini-cli, nvidia, huggingface)

Add rates for the 5 remaining unpriced hosted providers in session_ingest.py DEFAULT_PROVIDER_RATES, then re-run `session_ingest.py --reprice`.

Current gap (all in ~/.pi/agent/metrics/rounds.jsonl):
- 9router-kiro: 32 recs, 8.3M tokens — paid local gateway (localhost:20127), rate pending from user
- nano-gpt-qwen: 34 recs, 13.6M tokens
- google-gemini-cli: 15 recs, 3.0M tokens
- nvidia: 30 recs, 2.7M tokens
- huggingface: 10 recs, 0.4M tokens

Procedure (established for crusoecloud + cerebras):
1. Fetch per-M token pricing from each provider's site
2. Add provider-qualified (provider, model) entries to DEFAULT_PROVIDER_RATES
3. Run `python3 session_ingest.py --reprice` (backs up + verifies automatically)
4. Confirm with `python3 session_ingest.py --verify`
