# extensions/

Place pi extensions here.

Current extensions:

- `pi-codex-rotator.ts` → rotates `openai-codex` credentials on quota exhaustion using a shared account pool
- `pi-bash-20kb.ts` → overrides `bash` and fails when output exceeds 20KB (or is truncated), instructing the model to run narrower commands
- `flexible-role-agent.ts` → stable context-builder system prompt + post-history roles via `--frag` / `/frag set <role>` (role swaps never bust cache; mode swaps warn: Continue | Fork | Cancel). Roles: `coding-agent` (default), `analyst`, `pkm`, `cbt`, `dp`, `socratic-tutor`. Launch flags: `--frag`, `--coding`, `--pkm`, `--cbt`, `--dp`, `--socratic-tutor`.
- `archived/pi-dp-mode.ts`, `archived/pi-socratic-tutor-mode.ts`, `archived/pi-pkm-mode.ts`, `archived/pi-cbt-mode.ts` → superseded by the `dp`, `socratic-tutor`, `pkm`, and `cbt` roles above.
- `pi-redraw-screen.ts` → `/redraw` command and optional keyboard shortcut to redraw the screen
- `pi-compaction-modes.ts` → compaction modes (`programmatic`, `cached`, `cached-agentic`, `cached-agentic-tooltraces`, `cached-handoff`, `cached-handoff-tooltraces`, `cached-summary-tooltraces`, `vanilla`) with settings-backed selection, ordered markdown tool traces, cwd/home-relative path display, and cache-friendly "dance" modes that produce the summary via a normal chat turn
- `timestamp-toolcalls.ts` → append local timestamp to every user message so the agent knows current time (format: `YYYY-MM-DDTHH:MM:SS`)
- `tps.ts` → show tokens-per-second and token usage summary after each agent run, vendored from pi-mono
- `pi-cache-miss-notice.ts` → persist significant prompt-cache misses to the session as `custom` entries (customType `cache-miss-notice`), so they survive resume/compaction and appear in session logs; renders in chat with the same wording as pi's built-in notice. Disable via `{ "cache-miss-notice": { "enabled": false } }` in `~/.pi/agent/settings.json`.

Compaction mode setting:

```json
{
  "pi-compaction-modes": {
    "mode": "vanilla"
  }
}
```

Use `/compact set <mode>` to save one of `programmatic`, `cached`, `cached-agentic`, `cached-agentic-tooltraces`, `cached-handoff`, `cached-handoff-tooltraces`, `cached-summary-tooltraces`, or `vanilla`.

Patterns:

- `my-extension.ts`
- `my-extension/index.ts`

