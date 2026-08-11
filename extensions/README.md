# extensions/

Place pi extensions here.

Current extensions:

- `pi-codex-rotator.ts` → rotates `openai-codex` credentials on quota exhaustion using a shared account pool
- `pi-bash-20kb.ts` → overrides `bash` and fails when output exceeds 20KB (or is truncated), instructing the model to run narrower commands
- `pi-dp-mode.ts` → toggle deliberate practice coach mode via `/dp`
- `pi-socratic-tutor-mode.ts` → toggle Socratic tutor mode via `/socratic-tutor`
- `pi-pkm-mode.ts` → toggle Personal Knowledge Management mode via `/pkm`
- `pi-cbt-mode.ts` → toggle Cognitive Behavioral Therapy mode via `/cbt`
- `flexible-role-agent.ts` → stable context-builder system prompt + post-history roles via `--frag` / `/frag set <role>` (role swaps never bust cache; mode swaps warn: Continue | Fork | Cancel)
- `pi-redraw-screen.ts` → `/redraw` command and optional keyboard shortcut to redraw the screen
- `pi-compaction-modes.ts` → compaction modes (`programmatic`, `agentic`, `full`, `vanilla`) with settings-backed selection, agentic summaries, ordered markdown tool traces, and cwd/home-relative path display
- `timestamp-toolcalls.ts` → append local timestamp to every user message so the agent knows current time (format: `YYYY-MM-DDTHH:MM:SS`)
- `tps.ts` → show tokens-per-second and token usage summary after each agent run, vendored from pi-mono

Compaction mode setting:

```json
{
  "pi-compaction-modes": {
    "mode": "vanilla"
  }
}
```

Use `/compact set <mode>` to save one of `programmatic`, `agentic`, `full`, or `vanilla`.

Patterns:

- `my-extension.ts`
- `my-extension/index.ts`

