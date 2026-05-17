# pi-codex-model-guard-extension

Model downgrade warning extension for **pi**.

## What it does

- Overrides the `openai-codex` provider stream handler via `pi.registerProvider(..., streamSimple)`.
- Reads raw Codex `response.done` / `response.completed` payloads.
- If the **requested** model is `gpt-5.3-codex` and the **returned** `response.model` is different (for example `gpt-5.2-codex`), it shows a red warning in UI.
- Request continues (warn-only behavior).

## What it does not do

- Does not force model selection.
- Does not block prompts.
- Does not abort responses on mismatch.

## Commands

- `/codex-guard` toggle on/off
- `/codex-guard on`
- `/codex-guard off`
- `/codex-guard status`
- `/codex-guard test` (synthetic downgrade alert test)
- `/codex-guard clear` (clear red alert status)

## Optional startup flag

- `--codex-guard` (boolean, default: `true`)

## Local usage

From this folder:

```bash
cd /home/archimedes/code/pi-codex-model-guard-extension
pi -e ./extensions/codex-model-guard.ts
```

Or by absolute extension path:

```bash
pi -e /home/archimedes/code/pi-codex-model-guard-extension/extensions/codex-model-guard.ts
```

## Install as a package

```bash
pi install git:github.com/<your-org>/pi-codex-model-guard-extension
# pinned
pi install git:github.com/<your-org>/pi-codex-model-guard-extension@v0.1.0
```

Project-local install:

```bash
pi install -l git:github.com/<your-org>/pi-codex-model-guard-extension
```
