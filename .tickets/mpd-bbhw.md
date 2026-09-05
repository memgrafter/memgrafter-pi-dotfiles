---
id: mpd-bbhw
status: open
open: true
deps: []
links: []
created: 2026-08-18T16:26:12Z
type: feature
priority: 2
assignee: memgrafter
tags: [video, multimodal, qwen]
---
# Video understanding via Qwen3.8-27B

Feature: give the agent a video-understanding path — feed a video (e.g. a scene
capture) to the model and get a description/analysis via the model's native video
modality. This ticket captures ONLY the Qwen-side requirements; the rest of the spec
is TBD (owner to complete).

## Qwen requirements (from the Qwen/Qwen3.8-27B model card)

- Model: Qwen/Qwen3.8-27B (siblings: Qwen3.8-9B, Qwen3.8-2.4T-A95B). Described as a
  "Causal Language Model with Vision Encoder", pipeline_tag image-text-to-text, built
  on the Qwen3.5 architecture.
- Native image AND video understanding: "from STEM diagrams and documents to
  hour-scale videos."
- Video is passed as an OpenAI-style content item:
      { "type": "video_url", "video_url": { "url": "<...>.mp4" } }
  i.e. the input is a URL to an MP4. No separate base64-video path is documented.
- Default frame sampling is fps=2 with do_sample_frames=true (vLLM). A 4 s clip is
  therefore sampled to ~8 frames.
- To change the sampling rate you must set:
      extra_body = { "mm_processor_kwargs": { "fps": N, "do_sample_frames": true } }
  This is supported ONLY in vLLM and requires the server to be launched with
  --media-io-kwargs '{"video": {"num_frames": -1}}'.
- Long-video note: the released video_preprocessor_config.json sets a conservative
  `size` to optimize plain-text/image latency; long / hour-scale video may need that
  `size` (and the fps above) tuned up.

## Video lifecycle (decided)

- The video block is **ephemeral**; a text note carrying the source path is the permanent record.
  At attach time the message content is `[text: "[video: <path>]", video block]`, where `<path>`
  is however the video entered the session: `@file` → resolved path, `read` tool → path argument,
  clipboard paste → temp file path.
- **Session file never stores the video.** The persist path (`session-manager.ts` `appendMessage` →
  `_persist`) drops `video` blocks; only the text note is written.
- **Dropped from chat after the turn.** During the turn (all tool-call round trips) the video stays
  in context. At `turn_end` (and on aborted/error turn end, `agent-session.ts`) the video block is
  removed from in-memory history, so no subsequent request re-sends it. Re-attaching means
  re-adding the file.
- Resuming a session from file therefore never re-exposes the video — by design.

## Transport (decided)

- Wire format is the OpenAI chat-completions `video_url` content part — same field shape as
  `image_url` (`openai-completions.ts:1117` builds `url: data:<mime>;base64,...` for images;
  video clones this with `data:video/mp4;base64,<mp4>` first — no serving infrastructure needed).
- If the vLLM server rejects data: URLs for video, fall back to an http(s) URL (serving stack TBD
  then).
- Frame sampling: fps via `samplingParams.mm_processor_kwargs = { fps, do_sample_frames }` — merged
  into the top-level request body by the existing `Object.assign(params, options.samplingParams)`
  (`openai-completions.ts:886`). Default fps=2; only effective when the server was launched with
  `--media-io-kwargs '{"video": {"num_frames": -1}}'`, so safe to send unconditionally.

## Findings (2026-08-18, vllm 0.27.1 on vert, qwen3.8-27b-autoround-int4)

- **data: URLs work.** End-to-end test: 3 s testsrc mp4 as `data:video/mp4;base64,...` in a
  `video_url` part → 200, model correctly described the clip. No serving infra needed.
- **Hazard: vLLM mm P0/P1 cache desync.** Re-sending the *same* video bytes across multiple
  requests of one run (exactly what the extension does) can make the API server send a
  reference-only mm feature while the engine's receiver cache lacks the item →
  `AssertionError: Expected a cached item for mm_hash=...` (seen in vert logs 08-17 20:48–20:55,
  same hash repeated). Mitigations: (a) server flag `--mm-processor-cache-gb 0`, or
  (b) extension-side per-request hash uniquification — IMPLEMENTED in extensions/pi-video.ts:
  each request appends a `free` atom (ignored by mp4 demuxers) with a unique 16-byte payload
  to mp4/m4v/mov bytes, so every request carries a fresh hash and a full item. webm/mkv are
  sent as-is (still exposed to the desync risk).
- **The 400 "Failed to apply Qwen3VLProcessor" is SOLVED (2026-08-18).** It WAS from vert's
  container (log line 20280, 08-18 20:52:21 — the last request of the prototyping session's run).
  Root cause, reproduced deterministically: the extension sent `mm_processor_kwargs:
  {fps: 2, do_sample_frames: true}` on every video request, but this vLLM was NOT launched with
  `--media-io-kwargs '{"video": {"num_frames": -1}}'` — the model card says explicit fps sampling
  requires that flag. Same request without the kwarg → 200 with a correct description. Fix
  (implemented in extensions/pi-video.ts): `mm_processor_kwargs` is now sent ONLY when
  `PI_VIDEO_FPS` is explicitly set to a non-default value; the default path sends no kwarg and
  relies on the server's own fps=2 default, which works on any vLLM.
  (The `size` pixel-budget theory is dead; the `'text': ''` in the error was a side effect of the
  explicit-kwargs code path, not an empty prompt.)
- Startup warning "treated as multimodal but has no registered multimodal processor; running in
  text-only mode" is a red herring — video demonstrably works (vLLM 0.27.1 registers
  Qwen3VLMultiModalProcessor for Qwen3_5ForConditionalGeneration).

## Rest of spec
TBD — owner to complete (acceptance criteria, cost/latency for long video, source of the
Qwen3VLProcessor 400).
