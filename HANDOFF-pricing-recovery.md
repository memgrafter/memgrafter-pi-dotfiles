# HANDOFF — Test: "?" (unknown-model) record recovery & pricing

Test this fix before trusting the monthly cost tables. It touches `session_ingest.py`
(parse + `--reprice`) and the live `~/.pi/agent/metrics/rounds.jsonl`.

## Why this fix exists

The monthly cost tables showed a busted `write` column: month totals included
cache-write tokens that the top-3-by-cost rows did not show, and 225 records had
`model: "?"` — **unpriced but not free** (145M cacheRead + 5.2M input + 1.8M
write tokens, worth ~$66 at claude/gpt rates).

Root cause: old-format session files (no `model_change` entries) still carry
`model`/`provider` on assistant messages, but the parser only tracked
`model_change`. All 225 "?" records came from 8 such files (5× gpt-5.3-codex /
openai-codex, 3× claude-opus-4-6 — the "anthropic" strings in those files are
config text in user prompts, not the provider).

## What changed (commits `ba56849`..`e76b0ec`)

1. `parse_session_file`: assistant messages now contribute
   `model`/`provider` as fallback when `model_change` entries are absent.
2. `--reprice` gained session-file recovery: for zero-cost records with
   `model` in (None, "?"), it locates the session file (by `sessionFile`
   basename) in `--sessions-dir` **and** `~/.pi/agent/sessions`, re-parses,
   updates `model`/`provider`/`models`, then prices the record.
3. Records with zero tokens (aborted rounds, EMPTY_USAGE) are correctly left
   alone — they are genuinely $0, not a gap.

## Repro / test procedure

Setup (safe, non-destructive — uses a temp copy):

```bash
cd /Users/trentrobbins/code/memgrafter-pi-dotfiles
cp ~/.pi/agent/metrics/rounds.jsonl /tmp/reprice-test.jsonl

# 1. Recovery + repricing on the temp copy (needs argent's session files)
python3 session_ingest.py --metrics /tmp/reprice-test.jsonl \
    --sessions-dir /tmp/argent-sessions --no-backup --reprice
```

Expected: `216 record(s) filled, +$65.9015 total (216 model recovered)` and
`post-reprice verify ok: 17458 priced cost objects agree`.

```bash
# 2. No "?" records with tokens may remain
python3 -c "
import json
recs = [json.loads(l) for l in open('/tmp/reprice-test.jsonl') if l.strip()]
q = [r for r in recs if (r.get('model') or '?')=='?' and (r.get('usage') or {}).get('totalTokens')]
print(f\"'?' records WITH tokens remaining: {len(q)}\")   # must be 0
"
```

```bash
# 3. Write column reconciles: per-model cacheWrite must sum to the totals
python3 -c "
import json
from collections import defaultdict
recs = [json.loads(l) for l in open('/tmp/reprice-test.jsonl') if l.strip()]
tot = sum((r.get('usage') or {}).get('cacheWrite') or 0 for r in recs)
per_model = defaultdict(int)
for r in recs:
    if (r.get('usage') or {}).get('cacheWrite'):
        per_model[(r.get('provider'), r.get('model'))] += (r.get('usage') or {}).get('cacheWrite')
print('total write:', f'{tot:,}')
print('per-model sum:', f'{sum(per_model.values()):,}')   # must equal total write
print('models with write:', len(per_model))
"
```

```bash
# 4. Idempotency: re-running reprice changes nothing
python3 session_ingest.py --metrics /tmp/reprice-test.jsonl \
    --sessions-dir /tmp/argent-sessions --no-backup --reprice
# expect: 0 record(s) filled (verify +$0.0000)
```

```bash
# 5. Full verify on the temp copy
python3 session_ingest.py --metrics /tmp/reprice-test.jsonl --verify
# expect: verify ok: 17458 priced cost objects agree
```

## Current verified state (2026-08-11)

- Live file: 22,5xx records, **$6,508.76** total, verify 17,458 priced objects
  agree. Reprice applied on the live file (backup:
  `~/backups/rounds.jsonl_2026-08-11_06-57-45.bak`).
- `'?'` records with tokens: **0**. Remaining "?" records (8) are zero-token
  aborted rounds — correctly $0.
- Commits: `ba56849` (tooling+caveats), `8835195` (tickets), `e76b0ec`
  (recovery fix).

## Gotchas for the tester

- `/tmp/argent-sessions` must still exist (argent's rsync'd session files,
  1,048 files, 695M). If it was wiped (reboot), re-rsync:
  `rsync -a argent:'~/.pi/agent/sessions/' /tmp/argent-sessions/`.
- The live `rounds.jsonl` is append-only and growing (this pi session writes to
  it); always test against the temp copy first, never the live file directly.
- Rate sources: embedded `DEFAULT_RATES`/`DEFAULT_PROVIDER_RATES` in
  `session_ingest.py` + `~/.pi/agent/models.json` + `models-store.json`. If
  provider prices change, `--reprice` re-fills zero-cost records.

## Remaining known items (not part of this test)

- vert + stardart sessions: servers offline; ingest when back up.
- Ticket `mpd-mh7l`: rates still missing for 9router-kiro, nano-gpt-qwen,
  google-gemini-cli, nvidia, huggingface.
- 2 corrupt session files on argent (truncated, corrupt at source).
