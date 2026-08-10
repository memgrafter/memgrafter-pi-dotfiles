# memgrafter-pi-dotfiles

Local pi package for personal extensions, skills, prompts, and themes. Registered through the `pi` block in `package.json`.

Updated: `2026-05-16T22:58:21`

## Install

```bash
pi install /home/archimedes/code/memgrafter-pi-dotfiles
# or project-local
pi install -l /home/archimedes/code/memgrafter-pi-dotfiles
```

## Layout

- `extensions/` — TypeScript/JavaScript pi extensions
- `skills/` — skills as `SKILL.md` folders or top-level markdown files
- `prompts/` — prompt templates
- `themes/` — JSON themes

## Extensions

- `pi-codex-rotator.ts` — quota-aware `openai-codex` account rotation using `~/.pi/agent/pi-codex-rotator/`
- `pi-bash-20kb.ts` — fails broad shell output so commands stay focused
- `pi-dp-mode.ts` — deliberate-practice coach mode (`/dp`)
- `pi-socratic-tutor-mode.ts` — Socratic tutor mode (`/socratic-tutor`)
- `pi-pkm-mode.ts` — PKM mode (`/pkm`)
- `pi-cbt-mode.ts` — CBT mode (`/cbt`)
- `pi-redraw-screen.ts` — redraw command (`/redraw`)
- `pi-compaction-modes.ts` — compaction modes (`programmatic`, `agentic`, `full`, `vanilla`) with settings-backed selection, agentic summaries, ordered markdown tool traces, and cwd/home-relative path display
- `timestamp-toolcalls.ts` — append local timestamp to every user message so the agent knows current time (`YYYY-MM-DDTHH:MM:SS`)
- `tps.ts` — show tokens-per-second and token usage summary after each agent run, vendored from pi-mono
- `pi-prom-round.ts` — per-round metrics: appends one record per agent round to `~/.pi/agent/metrics/rounds.jsonl` (see `pi-prom-round.WIP.md`)

Draft or experimental extensions live in `extensions/draft/`.

### Compaction modes setting

```json
{
  "pi-compaction-modes": {
    "mode": "vanilla"
  }
}
```

Valid modes: `programmatic`, `agentic`, `full`, `vanilla`. Use `/compact set <mode>` to update the saved mode.

## Skills

- `skills/openrouter-typescript-sdk/SKILL.md`
  - vendored from openrouter
