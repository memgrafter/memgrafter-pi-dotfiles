---
name: h3-capabilities
description: Which MiniMax H3 capability to use for a shot, in which engine (FreeVideo or ComfyUI), with which settings and why: the draft and finish passes, the ComfyUI fast lane, keyframes, re-dress, what not to use, and what is still untested. Read before writing any H3 job file.
---

# H3 capabilities: what to use, how, and why

The evidence is the ComfyUI bake-off (ticket csc-wzib, 2026-11-08): 15 blind reads, 9 situations, 2 seeds, on vert's
RTX 3090s. The reads are in `h3/review/tests/comfy-bakeoff/reads/`; the letter key and the check images are in
`h3/review/tests/comfy-bakeoff-unblinded/`. All times are for one 5 s 768×1344 take on one 3090.
Running jobs: skill `h3-takes`. Experimental tools (mid-shot guides, re-dress): skill `h3-experimental`.

## 1. Pick the engine per shot (owner decision, 2026-11-08)

| Shot | Engine and settings | Why (blind reads) |
|---|---|---|
| ref2va (characters from reference pictures) with action or props | FreeVideo `light`. Draft with `level: "draft"`, finish with `finish` | FreeVideo ranked above every ComfyUI setting on zoomB2, run2tv, run2 s1023 and trust2 s1023 |
| fl2va (first and last frame) | ComfyUI, `steps` 4, `sparse` "sol13" (122 s) | Level with FreeVideo on hookfl2; ComfyUI ranked FINAL and FreeVideo below on the route-a-C one-take |
| t2va (text only) | ComfyUI 4-step Sol | A clean, closed 360° orbit at both seeds (FINAL) |
| Calm i2va (acting, small moves) | ComfyUI 4-step Sol | Level with FreeVideo on decide4 |
| i2va with a big camera move (orbit from a still) | FreeVideo | FreeVideo ranked above every ComfyUI setting on the orbit |
| A ComfyUI shot with fast action | ComfyUI `steps` 8 (205 s) | 8-step was best for action and props; on calm shots 8-step sometimes adds smoke or plumes, or drifts armour material |

Costume fidelity sometimes favoured ComfyUI (run2 s1024, trust2 s1024). The FreeVideo takes were existing production
takes of prompts written for FreeVideo, so ComfyUI may do better with prompts tuned for it (not tested).

## 2. Draft, then finish

**FreeVideo (exact).**
- A job with `"level": "draft"` runs `--preview`: only the 8 half-size steps, about 125 s.
- A later job with `"finish": "<draft name>"` runs `--refine-from`: the latent upscale, 3 refine steps and the decode, about 175 s.
- The result is identical to a `light` take at that seed.
- The finish job must repeat the draft's prompt text, task, inputs, seed, `w`, `h` and `seconds`. h3job.py checks each one against the draft's record and refuses on any difference, because the finish reuses the draft's stored first pass (`out/<draft>.artifacts/`).
- Run finishes in a later batch than their drafts.
- Cost: N drafts plus 1 finish = N×125 + 175 s, against N×233 s for full takes. That saves 24% at 3 drafts per keeper and 34% at 5. It loses at 1 draft per keeper; the break-even is about 1.6.
- Use it whenever you expect to look at 2 or more seeds per keeper. That is the normal case (h3-takes: 2 seeds per prompt version, then more seeds on the better one).

**ComfyUI (approximate).**
- The 4-step Sol take (122 s) and the 8-step Sol take (205 s) at the same seed keep the same composition and timing in most situations: coarse frame correlation 0.72–0.80, against 0.36–0.62 for unrelated seeds.
- Details, and sometimes the costume, change.
- Use the 4-step take to pick the seed, then run 8-step only where the shot needs it (fast action). For calm, fl2va and t2va shots the 4-step take is usually the final.

Seeds never carry between FreeVideo and ComfyUI. Choose the engine before drafting.

## 3. Job fields

FreeVideo jobs: as in `h3-takes`, plus `"level": "draft"` and `"finish"`.

ComfyUI jobs use the same fields plus `"engine": "comfy"`. Full list: `production/h3/comfy/comfyjob.py`.
```json
{"name": "cmf-<prompt>-s<seed>", "engine": "comfy", "task": "fl2va", "prompt": "<prompt>.txt",
 "first": "k0.png", "last": "k2.png", "w": 768, "h": 1344, "seconds": 3.75, "seed": 3101, "test": "cfv",
 "steps": 4, "sparse": "sol13"}
```
- **`task`:** ref2va needs `refs` (images only). i2va needs `first`. fl2va needs `first` and `last`. t2va needs neither.
- **`seconds`** is required. It rounds up to the 17k+5 frame grid at 24 fps (5 s = 124 frames). The model's trained range is about 124–362 frames.
- **`steps`:** 4 (default) or 8. Each loads the matching LightX2V Turbo LoRA: ref2v 4-step v1.0 or 8-step v1.1; fl2v 4-step v1.3 or 8-step v1.1.
- **`sparse`:** "sol13" (default) is Sol-Attn at τ 1.3. It matched dense attention at the same step count in 14 of 15 comparisons and is 1.2× faster. "none" means dense INT8 attention.
- **Fixed settings:** the Comfy-Org int8_convrot checkpoints (the ref2va model for ref2va; the fl2va model for i2va, fl2va and t2va), comfy-kitchen INT8 attention, MiniMaxH3SigmaShift 12/3, euler sampler, simple schedule, 24 fps, ComfyUI pinned at commit bdb0816a.
- **Naming:** prefix ComfyUI takes `cmf-` so reads and the log show which engine made them. `h3.py run/status/pull` treat them like FreeVideo takes.
- **ComfyUI fl2va end pose:** in the route-a reads, every ComfyUI fl2va take reached the last frame about 1 s early and held it. Plan a trim, or allow ~1 s more than the move needs.

## 4. Running ComfyUI lanes (vert)

- Each lane starts one ComfyUI server on its GPU at its first comfy job (port 8288 + GPU) and reuses it for the rest of the lane. The log is `~/clip-gen/comfy-h3/logs/comfy-lane-g<N>.log`. The first take adds 25–30 s of model loading when the files are in the OS cache, and more from a cold disk.
- **RAM is the limit (31 GB on vert).**
  - Run at most 3 ComfyUI lanes at once (`h3.py run ... --gpus 0,1,2`).
  - Run at most 1 lane with a `control` job, and nothing else beside it. A ControlNet lane holds about 17–20 GB.
  - Two lanes died in the bake-off when RAM peaked at 30.3 and 31.8 GB. It was almost certainly the OOM killer; dmesg can't be read as user plato.
- ComfyUI runs have no RAM guard (FreeVideo's `guarded.sh` doesn't wrap them). Only h3job.py's start-of-job memory admission applies.
- A lane can mix FreeVideo and ComfyUI jobs. Before each FreeVideo job the lane stops its ComfyUI server, which would
  otherwise keep its models on the GPU, and it starts again at the next comfy job. Every engine switch reloads models,
  so put jobs of one engine and one model family (ref2va vs the rest) together. The mixed-lane path was tested only in
  dry-run mode.

## 5. Don't use (and why)

| Option | Why not |
|---|---|
| W4A4 (convrot_w4a4) | 103 s with Sol, but unusable in every read, including when exported from bf16. Seeds don't carry over either. |
| W6A8, W4A8 | No faster than int8 on a 3090 (152.6 s vs 150 s dense); adds strobing and colour casts |
| FP8, NVFP4, MXFP8, "FP4 Marlin" | Emulated on a 3090 (sm_86), with no native kernel; comfy-kitchen has no Marlin kernel. SGLang's Marlin FP4 covers only the text encoder's LLM layers, not the H3 DiT. |
| Sol τ 2.0 | 114 s, but strobes at some seeds |
| Kablex Ref2VA-VSA node | Superseded by core Sol-Attn: 140 s vs 122 s, a transplanted gate trained on fl2va, and +12 GB RAM per lane. Its gate file was deleted from vert. |
| pytorch attention | 206 s. comfy-kitchen INT8 attention is 1.4× faster. |
| Dense 8-step | 268 s, slower than FreeVideo. Sol 8-step gives the same picture in 205 s. |
| FreeVideo `--step-cache easycache-av` | 256.6 s vs 233 s, no gain |

Rule: on a 3090, speed comes from attention (INT8 attention, then Sol-Attn), not from weight format.

## 6. Available but untested

These are in ComfyUI bdb0816a or in our files. None has been run. Test one before relying on it.

| Capability | Node or field | What it could give |
|---|---|---|
| ComfyUI two-pass (half size → learned latent upscale → refine) | `MiniMaxH3LatentUpscaleWithModel` + `LatentUpscaleModelLoader` | Could make ComfyUI's draft→final exact, like FreeVideo's. FreeVideo's upscaler file (`fv-root/models/vdn/latent_upscaler/minimax_h3_latent_upscaler_3d_conv_v1_fp16.safetensors`) has the tensor names ComfyUI's loader detects as the H3 upscaler, so a symlink would probably work. |
| Full-size reference pictures | `ref_image_size: "max"` on MiniMaxH3ReferenceToVideo (we used "match") | Better identity and costume fidelity (2048 px short edge); ComfyUI says it "can be several times slower" |
| Reference videos and reference audio | `ref_videos` (up to 3, 2–15 s), `ref_video_audios`, `ref_audios` | Motion or voice from a reference. comfyjob.py refuses non-image refs until this is tested. |
| Anchoring a soundtrack at a frame | `audio` input of MiniMaxH3AddGuide | Lock a voice line or sound to a time |
| Regenerating only a region | `mask` + `source_video` on MiniMaxH3FunControlNetApply | Redo only the beast or a prop and keep the rest of a take |
| p-h3-image stills | `PH3ImageConditioning` | Text-to-image and edits. Needs the p-h3-image model, which we don't have. |

## 7. Disk (vert, after cleanup 2026-11-08)

`~/clip-gen/comfy-h3/ComfyUI/models/` holds:
- `diffusion_models/`: ref2va and fl2va int8_convrot (20 GB each);
- `loras/`: the four 768p Turbo LoRAs (1.9 GB each);
- `model_patches/`: the Fun ControlNet union int8 (2.2 GB);
- `vae/`: the video VAE fp16 (5 GB) and audio VAE fp32 (0.6 GB);
- `text_encoders/`: the text encoder, a symlink to FreeVideo's copy (15 GB, not duplicated).

What the two engines share:
- **Text encoder:** shared through the symlink.
- **VAEs:** the same models in both engines (equal parameter counts, most tensors identical), but each file has a different layout and precision, so they can't be symlinked.
- **DiTs:** FreeVideo's OpenVDN edge int8 checkpoint (stage-dmd-step-250) and Comfy-Org's checkpoints are different models.

Deleted: the bf16, W6A8, W4A8 and W4A4 checkpoints, the Kablex gate, and the ref2v 4-step v0.1 LoRA. To re-run those bake-off arms: `production/h3/comfy/dl.sh`, `dl2.sh`, `convert.py`.
