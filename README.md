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
- `timestamp-toolcalls.ts` — append local timestamp to every user message so the agent knows current time (`YYYY-MM-DDTHH:MM:SS`)

Draft or experimental extensions live in `extensions/draft/`.

## Skills

- `skills/openrouter-typescript-sdk/SKILL.md`
  - vendored from openrouter
