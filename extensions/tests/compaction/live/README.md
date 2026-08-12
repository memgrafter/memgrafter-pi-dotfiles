# Live compaction-mode tests

End-to-end tests for `extensions/pi-compaction-modes.ts`. Each test runs a real
pi session in a tmux window and drives it with `/compact`.

## Prerequisites

- `pi` on PATH (provider deepseek, model deepseek-v4-flash)
- tmux
- The compaction extension installed or passed via `--extension`

## Run

```bash
extensions/tests/compaction/live/run.sh
```

`run.sh` creates tmux session `comp-test` with one window per mode (8 total),
boots pi in each, and launches one `drive.py` per window in parallel.

Each session sequence:

1. Haiku turn (context)
2. Bash tool-use turn (context, tooltrace content)
3. Filler paste turn (~33k tokens, so the session exceeds `keepRecentTokens` and `/compact` is allowed)
4. `/compact` (dance modes inject a summary request; programmatic/vanilla compact directly)
5. Post-compact follow-up (`POST_COMPACT_OK`)

## Verify

```bash
extensions/tests/compaction/live/verify.py <mode>
# example:
extensions/tests/compaction/live/verify.py cached
```

Checks per mode:

- Exactly one injected dance message (no re-injection loop)
- Compaction entry present, `details.mode` matches, `tokensBefore` present
- Dance modes: `firstKeptEntryId` is the keep-none sentinel
- Tooltrace modes: summary contains the `Programmatic` section
- Summary reply captured between injection and compaction entry
- Summary reply `cacheRead` ~= full context (provider cache reuse)
- Post-compact follow-up reply works

## Layout

- `run.sh` — create tmux session, boot pi, launch drivers
- `drive.py <mode> <win>` — drive one session
- `verify.py <mode>` — verify one session file
- `runs/<mode>/` — cwd, seeded `.pi/settings.json`, session files, driver logs (gitignored)

## Notes

- Session files live in `runs/<mode>/sessions/`.
- The mode is seeded per-run in `runs/<mode>/.pi/settings.json`; use plain
  `/compact` (not `/compact <mode>`). Phase 3 of the dance resolves the mode
  from settings, not from the `/compact` argument.
