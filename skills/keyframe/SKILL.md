---
name: keyframe
description: Pin what H3 can't get from text (an object's size, who holds what, darkness, an end pose) by making FLUX keyframe stills on vert, with the edit recipe that keeps Crimson Frost on-model. Use whenever a beat needs a first, last or middle frame, or a frame needs fixing.
---

# FLUX keyframes

Beats where an object appears or changes hands took 10–15 prompt versions on 2026-11-05 until frames were pinned.
FLUX keyframes plus H3 first/last-frame segments fixed them.

## When to use
- A beat needs an exact end pose, darkness, or an object at the right size (the trout: no frame meant a giant trout).
- A video frame needs to be sharpened or fixed before it becomes an input frame.
- Not for B-roll stills (`production/imagegen/`).

## Run
```bash
cd production/h3/keyframes
# job: kf-<round>.json = {"model": "flux3", "items": [{"id", "prompt", "refs": [Crimson Frost's art, the frame], "seeds": [1,2,3], "w": 768, "h": 1344}]}
python3 -I kfrun.py run kf-<round>.json [--gpu 3]     # prints the Monitor command
python3 -I kfrun.py pull kf-<round>                  # -> h3/keyframes/kf-<round>/
python3 -I kfrun.py pick kf-<round>/<id>_s<seed>.png <name>    # ONLY after the owner approves that still
```
References are vert paths (`/home/plato/clip-gen/h3/in/...`); Crimson Frost's portrait is `in/crimson-frost-portrait.jpg`.
`kfrun.py run` refuses a GPU with a live H3 lane. FLUX 3 is about 46 s an image; FLUX.2 (`--model=flux2`) about 6 s but off-model.

## The edit recipe (what worked)
1. References in order: Crimson Frost's reference art first, then the frame to edit. Say: "the woman must match the reference art in picture 1 completely" (FLUX doesn't know the name).
2. One change per pass. List the fix on its own line, and freeze everything else ("Keep everything exactly as it is, frozen: the
   camera, framing, cavern, lighting, the beast, the woman's pose, hair, cloak, armour, bow, the lantern in the woman's left hand ...").
3. FLUX keeps an object's size: it can't shrink something already drawn. Remove it or start from a frame without it.
4. Chain single-change passes (move the lantern; then make Crimson Frost grip the trout by its mouth).
5. To sharpen a soft video frame, give it as the moment and a sharp still as the style reference.
6. Darkness and lighting changes go in the keyframe: H3 won't darken a scene from text.
7. Name hands by picture side; state "the woman is the only person"; "dry"; hood state.

## Review
- Show each still to the owner on its own (`h3/keyframes/<round>/<file>`), with what it is for. Never a grid.
- Check Crimson Frost's canon look yourself first: hood down, gold mask emblem on the pauldron, crimson cloak, black scaled armour, bow.
- FLUX 3 licence (owner confirmed Qualifying User, 2026-11-05): outputs reviewed before display, AI-disclosed, never used to
  train. Each image is logged in its round's `log.jsonl`.
