---
name: h3-takes
description: Generate MiniMax H3 video takes on vert and get them in front of the owner with one command per step (start, status, pull into review packets), instead of hand-typing scp, lanes, monitors and hang checks. Use for any H3 clip work in this repo.
---

# H3 takes on vert

`production/h3/h3.py` replaces the hand-assembled round (about 260 shell calls and 26 handwritten hang checks on
2026-11-05). It stages inputs, spreads jobs over free GPUs, starts the lanes, writes the Monitor command and hang-check
prompt for you, and pulls finished takes into one review packet per take.

## When to use
- Any MiniMax H3 generation (i2va, fl2va, ref2va, continuation) for a short.
- Not for FLUX stills (skill `keyframe`), and not for building a draft (`make_draft.py`).
- Before writing the job file, pick the engine and settings per shot: skill `h3-capabilities`.
  - FreeVideo: ref2va action and props, big-move i2va.
  - ComfyUI (`"engine": "comfy"`): fl2va, t2va, calm i2va.
  - Experimental tools (mid-shot guides, re-dress): skill `h3-experimental`.

## Before generating (gates; repo AGENTS.md: no new clips until planned with the owner)
1. The beat is on the owner-approved beat board, and every keyframe used as first/last frame or reference was shown to
   the owner alone and approved.
2. Write the prompt in `production/h3/prompts/<prompt>.txt` (format: `production/h3/README.md`, "Prompts"). Every prompt states:
   - Crimson Frost is the only person in the scene (prompts describe Crimson Frost by appearance: "a young woman ranger ..."; H3 doesn't know the name);
   - everything is dry (no water, no drool);
   - hands by picture side ("the woman's LEFT hand, on the left of the picture", seen from behind);
   - hood down unless the action raises it;
   - for calm beats, the beast never roars or bares its fangs;
   - every object that appears or changes hands is in a keyframe at the right size.
3. Write the job file `production/h3/jobs/<batch>.json` (a list; fields in `h3job.py`'s docstring). Inputs go in
   `/Volumes/ExternalData/social-content/h3/in-frames/`. Name takes `cfv-<prompt>-s<seed>`, `test: "cfv"`.
4. Seeds: 2 per prompt version, then go deeper on the better one (owner: "a few seeds then serial depth").
   - FreeVideo seeds run as drafts: `"level": "draft"` (~125 s, half size).
   - Finish only the keeper, in a later batch, with a job that repeats the draft's fields and adds
     `"finish": "<draft name>"` (~175 s).
   - The finished take is identical to a `light` take at that seed; h3job.py refuses a finish whose fields differ.
   - Name drafts `cfv-<prompt>-s<seed>-draft` and finishes `cfv-<prompt>-s<seed>`.
   - Read drafts like takes. They are half size, so judge motion, staging and objects, not fine detail.
   - ComfyUI seeds also run as drafts: `"level": "draft"` (Sol-Attn 4-step, 122 s). The final is the same job without
     `level` at the same seed (dense attention, close to the draft but not exact). Sol-Attn is never used for a final
     (owner rule, 2026-11-08); the runner refuses `sparse`. Details: skill `h3-capabilities` §2. If a beat fails
   3 prompt versions on the same problem (an object floating, appearing from nowhere, or the wrong size), stop rewording
   and pin frames instead: FLUX keyframe, first/last frame, then the stitch technique (`docs/H3_TECHNIQUES.md` §4).

## Run
```bash
cd production/h3
python3 -I h3.py run jobs/<batch>.json [--gpus 0,1,2,3] [--dry-run]
```
- It prints a MONITOR command: start it with the Monitor tool (timeout 30 min, re-arm on expiry).
- It prints a HANG CHECK prompt: CronCreate it every 5 minutes; it deletes itself when the batch ends.
- Never wait in the foreground; keep working. Never touch tmux session "0" on vert.
- Lane layout (cycle time first): with more free GPUs than prompts, each seed gets its own GPU; otherwise one prompt's seeds share a lane.

## Status and pull
```bash
python3 -I h3.py status [batch]     # state per run, RAM, GPUs, lanes
python3 -I h3.py pull [batch]       # sha256-checked copy to h3/cfv/, h3/log.jsonl, one packet per take
```
Packets land in `h3/review/tests/takes-<batch>/<take>/`: the mp4, its `first-`/`last-`/`ref-` input frames, `prompt.txt`.

## After pulling
1. Read every take neutrally before using or showing it: the `take-read` skill.
2. Show the owner each take on its own, never in a grid, as a numbered list with exact packet paths.
3. A composite (stitch) goes in `h3/composites/`, never in `h3/cfv/`.

## Facts that matter
- Native size is 768×1344 (FreeVideo guide: "native 0.98 MP"). Local H3 tops out at a 768 px short edge; 1080p/2K are
  hosted regeneration steps in the APIs (Pika-H3-Flex README; LocalVideoGen README). A 1088×1920 local test was run on
  2026-11-05 (batch `res-1088x1920`, see `docs/H3_TECHNIQUES.md`).
- We run the edge int8 model at `light` (8 half-size steps + 2× learned upscale + 3 refine). Measured: about 4.2
  lane-minutes per take, 4 lanes at once (2026-11-05).
- Draft mode is that same `light` run split in two: draft = the half-size pass, finish = upscale + refine. Adopted
  2026-11-08 (csc-wzib).
- ComfyUI jobs: at most 3 lanes at once, and only 1 when a job has `control` (RAM; skill `h3-capabilities` §4).
- Lengths round up to 17n+5 frames at 24 fps; minimum 1.625 s. fl2va pins only the first and last frame.
- Licence (AGENTS.md): every generation is logged (pull does it), the owner reviews before posting, outputs are labelled
  machine-generated, and outputs are never used to train a model.
