# extensions/

Place pi extensions here.

Current extensions:

- `pi-openrouter.ts` → registers the `openrouter` provider
- `pi-codex-rotator.ts` → rotates `openai-codex` credentials on quota exhaustion using a shared account pool
- `pi-bash-20kb.ts` → overrides `bash` and fails when output exceeds 20KB (or is truncated), instructing the model to run narrower commands
- `pi-dp-mode.ts` → toggle deliberate practice coach mode via `/dp`
- `pi-socratic-tutor-mode.ts` → toggle Socratic tutor mode via `/socratic-tutor`
- `pi-pkm-mode.ts` → toggle Personal Knowledge Management mode via `/pkm`
- `pi-cbt-mode.ts` → toggle Cognitive Behavioral Therapy mode via `/cbt`
- `pi-redraw-screen.ts` → `/redraw` command and optional keyboard shortcut to redraw the screen

Patterns:

- `my-extension.ts`
- `my-extension/index.ts`

