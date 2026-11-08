---
name: h3-experimental
description: Experimental ComfyUI H3 tools, with how to run each, what worked and what failed, and how to check a take: mid-shot keyframe guides (a still or a short motion clip anchored inside one take) and ControlNet re-dress (keep an existing take's motion, re-take identity from the reference pictures). Use only when the standard paths in h3-capabilities can't do the shot.
---

# H3 experimental tools (ComfyUI)

These are not production paths. The owner decided (2026-11-08) to keep them as experiments. Each worked at some seeds
and failed at others. Before using one, try the standard path (skill `h3-capabilities`). After a take, read it with
the `take-read` skill plus the frame checks below; don't trust a contact sheet alone.
Evidence: ticket csc-wzib, reads `h3/review/tests/comfy-bakeoff/reads/` (routeaC-s1023.md, routeaC-s1024.md,
k1clip.md, fish1take.md, redress.md), check images `h3/review/tests/comfy-bakeoff-unblinded/`.

Both tools are ComfyUI job fields (`"engine": "comfy"`, `production/h3/comfy/comfyjob.py`). Their files go in
`h3/in-frames/` like keyframes, and `h3.py run` stages them.

## 1. Mid-shot keyframe guide (`guides`, i2va and fl2va only)

**What it is.** FreeVideo fl2va pins only the first and last frames. ComfyUI's `MiniMaxH3AddGuide` also anchors
pictures at any frame inside the take, so a K0→K1→K2 route can be one take instead of two takes joined with a trim
(the `stitch` skill).

**Two forms:**
```json
"guides": [{"frame": 34, "clip": "ra-a-s3101.mp4", "start": 34, "length": 5}]
"guides": [{"frame": 70, "image": "kf-fish-mid-c.png"}]
```
- **`clip`:** anchors frames `start` … `start+length-1` of a video at frames `frame` … onwards. `length` must be 5, 22, 39, … (17k+5); ComfyUI crops other lengths to that grid.
- **`image`:** anchors one still at `frame`.
- **Several guides:** chain them by listing several entries.
- A negative `frame` counts from the end. Not tested.

**What happened:**

| Test | Result |
|---|---|
| route-a-C (fast pose change: K0 → K1 raise lantern → K2), single K1 still at frame 38 | **Failed at 4 of 4 takes.** Hard cut to K1 (~1.0 s), freeze on K1 for ~1.4–1.7 s, hard cut to K2: a slideshow |
| Same, K1 still repeated ×5 as the clip | **Failed.** Freezes ~0.75 s (frames 26–44), near-cuts at frames 19–20 |
| Same, a 5-frame clip with real motion arriving at K1 (frames 34–38 of FreeVideo take ra-a-s3101) | **Works at 1 of 2 seeds.** s1023 passes K1 smoothly (distance 6.3, vs 22.5 for K0 to K1), with no cuts or freeze. s1024 passes K1 but ghosts (a double image, 2.04–2.27 s); it's usable as a draft only if cut at 2.0 s. |
| fish one-take (141 frames; slow action; the mid still fixes the fish's size), single still at frame 70 | **Ranked above FreeVideo's two-take join at both seeds** with Sol 4-step (s1024 > s1023 > FreeVideo join). It holds ~0.5 s before the keyframe, then rushes (8–12× the earlier rate of change). No hard cut. Without the mid keyframe the fish came out larger than her torso. |

FreeVideo's two-take join still ranked first on route-a (the reads' top pick there was FreeVideo takes Z3+Z4, with Z4's frames 0–1 trimmed).

**How to use it:**
1. **Prefer a motion clip to a still.** The clip must contain real motion arriving at the keyframe. Take the last 5 frames of an existing take that ends on the keyframe pose (e.g. a FreeVideo K0→K1 take). A still repeated 5 times freezes just like a single still.
2. **A single still works only for slow action,** where the keyframe mostly pins size or position (the fish). For a fast pose change it cuts.
3. **Run 2+ seeds.** With 1 of 2 seeds clean, expect to discard about half.
4. **Settings:** Sol 4-step was fine (it ranked top on fish). Dense 8-step changed nothing in the outcome.
5. **ComfyUI fl2va reaches the last frame ~1 s early and holds,** so plan a trim.

**Check every take for:**
- hard cuts: a 96×168 grey frame difference above ~8 between neighbouring frames;
- freezes: a difference under ~0.4 for 4+ frames;
- ghost doubles near the guide frames;
- the speed jump after the keyframe.

The take-read skill's frames.py gives the strips. The scripts in the ticket notes (csc-wzib, 02:40 and 03:01 PST) give the numbers.

## 2. ControlNet re-dress (`control`)

**What it is.** It keeps the motion, timing and camera of an existing take (its Canny edges drive the new take) and
takes the characters from the job's reference pictures. Use it for a take with good motion but the wrong costume.

```json
{"engine": "comfy", "task": "ref2va", "refs": [{"path": "crimson-frost-portrait.jpg"}, {"path": "lantern-cavern-beast.png"}],
 "prompt": "cfv-run2.txt", "seconds": 5, "steps": 8, "sparse": "none",
 "control": {"video": "cfv-h3x-run2-base-s1024.mp4", "strength": 1.0}}
```
The graph: LoadVideo → Canny (0.4 / 0.8) → `MiniMaxH3FunControlNetApply` (Fun ControlNet union int8). Keep the source video's length equal to the job's `seconds`.

**What happened** (source: FreeVideo take cfv-h3x-run2-base-s1024; outline match to the source, where 1.0 = identical):

| Setting | Outline match | Read |
|---|---|---|
| Dense 8-step, strength 1.0 | 0.70 / 0.72 | **Best.** Keeps the source's poses, timing and camera. Adds the crimson hood and cloak, the quiver, scaled armour. Still flips the hood at ~1.95 s; emblem unreadable; new fur and spark artifacts. Only slightly better than the source, which was already dressed from the same pictures. |
| Dense 8-step, strength 0.6 | 0.47 / 0.55 | Follows the source less |
| Sol 4-step, strength 0.6 (after the order fix) | mean frame distance to the source 22.1, vs 33.8 without ControlNet | Follows the source as well as dense 8-step at 0.6 (22.4); not blind-read |

**Verdict:** re-dress works partly. The motion is kept; the costume moves only a little toward the references.

**How to use it:**
1. **Use strength 1.0** for motion fidelity; 0.6 lets the take drift.
2. **Sol is fine:** comfyjob.py applies the ControlNet after Sol-Attn. If you ever build the graph by hand, keep that order. BlockSparseAttention replaces every block patch without chaining, so a ControlNet applied before it is silently dropped. That's how the first four Sol + ControlNet bake-off takes were wasted.
3. **RAM:** a ControlNet lane holds about 17–20 GB. Run one lane with `control` jobs and nothing else on vert at the same time. Two lanes died when RAM peaked at 30.3 and 31.8 GB.
4. **The source must be a finished take with the motion you want.** It won't fix motion problems; the source's hood flip came through.

## 3. Ideas worth testing next (not run)

- **Re-dress with `ref_image_size: "max"`:** may move the costume further. ComfyUI warns it can be several times slower.
- **ControlNet `mask` + `source_video`:** regenerate only a region (e.g. only the costume or only the beast) and keep the rest of the take exactly.
- **Guide clips of 22 frames:** more motion context than 5. Not tested.
