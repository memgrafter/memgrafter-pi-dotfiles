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
- `pi-qwen-reasoning-effort.ts` → adds a top-level `reasoning_effort` to provider requests for `qwen-chat-template` models that set `compat.supportsReasoningEffort: true` (e.g. local vLLM Qwen3), which released pi-ai never emits (it only sets `chat_template_kwargs.enable_thinking`). Maps pi thinking levels via `before_provider_request`: minimal/low → `low`, medium → `medium`, high/xhigh/max → `xhigh`; a model's `thinkingLevelMap` overrides the table, and unsupported levels (xhigh/max without a map entry) clamp to the nearest supported level, mirroring pi-ai's `clampThinkingLevel`.
- `pi-video.ts` → video understanding, keyed on the model the way the pi catalog keys image support on `Model.input`: the `VIDEO_CAPABLE_MODELS` table (Qwen3.8 family: 27B, 9B, 2.4T-A95B) decides, matched case-insensitively with the provider prefix ignored, so local vLLM ids like `qwen3.8-27b` work. Add new models to that table. Attach via `/video <path>`, `@<path>.mp4` in typed input, or the model itself via the `video` tool (like `read` for images). The video is injected into the provider payload as a `video_url` part (data: URL) for the duration of the run, then dropped on `agent_settled`. Each request appends a unique `free` atom to mp4/mov bytes so vLLM's P0/P1 media caches never see a repeated hash (avoids the `Expected a cached item for mm_hash=...` desync). The session only stores a `[video: <path> #<id>]` text marker — never the bytes. Env: `PI_VIDEO_MAX_MB` (default 50). `PI_VIDEO_FPS` is unset by default — the server's own sampling (fps=2) is used and no `mm_processor_kwargs` is sent; setting it sends `mm_processor_kwargs.fps`, which requires the vLLM server to be launched with `--media-io-kwargs '{"video": {"num_frames": -1}}'` (otherwise vLLM 400s with "Failed to apply Qwen3VLProcessor").

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

