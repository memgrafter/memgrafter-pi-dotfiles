# H3 ComfyUI bake-off: every finding (csc-wzib, 2026-11-08)

The complete record behind the skill `h3-capabilities`: owner verdicts, measurements, and every reader verdict per
scene × setting × seed. The skill's advice is a summary of this file. When a rule or verdict changes, add it here
first, then check the skill against this file. The skill was written from rankings by engine, which dropped the
per-setting verdicts that decided the later questions.

Sources: the reads are in `/Volumes/ExternalData/social-content/h3/review/tests/comfy-bakeoff/reads/` (neutral Sonnet
readers, blind letters) and the key is in `.../comfy-bakeoff-unblinded/blindkey.json` and `zkey.json`. The takes are in
`.../comfy-bakeoff/blind/<scene>/`. The ticket is csc-wzib in `~/code/characteragent.ai-social-content`.

Setting tags: `int8` / `w6a8` / `w4a8` / `w4a4` (`w4a4bf` = exported from bf16) = weight format; `ck` = comfy-kitchen
INT8 attention (`pt` = pytorch); `none` = dense attention, `sol13` / `sol20` = Sol-Attn τ 1.3 / 2.0; `4s` / `8s` =
Turbo LoRA steps; `cn1.0` = ControlNet strength. FreeVideo takes (`Z`) are `light` production takes at their own seeds.

## 1. Owner verdicts (they override the reader)

| Date | Scene / topic | Owner verdict | Measured detail |
|---|---|---|---|
| 2026-11-08 | Sol-Attn | "Trash, only for drafts now." No Sol-Attn on any final. | Rule enforced in comfyjob.py: only `"level": "draft"` gets Sol |
| 2026-11-08 | fish1take s1023-A (int8 Sol 4s + still at frame 70) | OK, but has a frame-rate issue | Container is a regular 24 fps. Near-freeze at 2.45–3.0 s (frames 59–72, 10 near-duplicate frames), then ~30× faster motion at 3.0–4.5 s. s1024-A: 1 near-duplicate, same rush. s1023-B (dense 8s) repeats every 4th frame at 3.3–4.1 s. |
| 2026-11-08 | orbitT2V E (W4A4 + Sol 4s), both seeds | Busted | Reader: UNUSABLE, both seeds |
| 2026-11-08 | k1clip | Only A (no mid guide) sort of worked; B and C don't properly fit onto the final keyframe K2 | All six end on K2's picture (48×84 grey distance 3.7–4.0; K1→K2 = 20.5). C hard-cuts into K2 (frames 62 and 65, 20 → 3.7 in one frame); B s1024 dissolves into it (ghost double 2.04–2.27 s). All arrive at frames 54–65 of 90, then freeze. |
| 2026-11-08 | decide4 picks | 1023 E (int8 dense 8s), 1024 F (W4A8 dense 4s) and G (int8 Sol 8s) | Reader ranks: E 4th, F 7th, G 3rd of 9 |
| 2026-11-08 | Engines | Adopt FreeVideo draft mode; add the ComfyUI lane for fl2va, t2va and calm i2va; guides and re-dress experimental; keep only the weights ComfyUI needs | Open: keep both engines, or FreeVideo only, now that Sol is drafts-only |

## 2. Measurements

**Speed** (warm seconds per 5 s 768×1344 ref2va take, one RTX 3090; FreeVideo `light` = 233 s):

| Setting | s | Setting | s |
|---|---|---|---|
| int8 Sol τ1.3 4s | 122 | int8 dense 4s | 150 |
| int8 Sol τ2.0 4s | 114 | int8 dense 8s | 268 |
| int8 Sol τ1.0 4s | 125 | int8 Sol 8s | 205 |
| W4A4 + Sol 4s | 103 | W4A4 dense 4s | 138 |
| W6A8 / W4A8 dense 4s | 152.6 | pytorch attention dense 4s | 206 |
| Kablex VSA 0.75 / 0.5 | 140 / 195 | FreeVideo `--preview` / `--refine-from` | 124–127 / 173–177 |
| FreeVideo `--step-cache easycache-av` | 256.6 | first take of a ComfyUI server (model load) | +25–30 |

**Seed carry-over** (coarse 12×21 grey-frame correlation at the same seed, mean over the bake-off pairs; unrelated seeds
of the same setting: mean 0.69, range 0.27–0.99):
- Sol 4s → dense 4s: 0.95 (lowest 0.81, n = 16).
- Sol 4s → dense 8s: 0.86 (lowest 0.63, n = 16).
- Sol 4s → Sol 8s: 0.89 (lowest 0.74, n = 10).
- Sol 8s → dense 8s: 0.96 (lowest 0.90, n = 10).
- FreeVideo draft → finish: exact (the finish equals a full `light` take at that seed).
- W4A4 never kept the shot. int8, W6A8 and W4A8 mostly did.

**ControlNet re-dress** (source cfv-h3x-run2-base-s1024; reader's outline match, 1.0 = identical): dense 8s cn1.0
0.70 / 0.72, dense 8s cn0.6 0.47 / 0.55. Mean grey-frame distance to the source: Sol 4s cn0.6 (correct order) 22.1,
dense 8s cn0.6 22.4, dense 8s cn1.0 16.2, no ControlNet 33.8. RAM: ~17–20 GB per ControlNet lane.

**Weights:** 4-bit layer error 16.0–21.8% (W4A4, same from int8 or bf16). FP8, NVFP4 and MXFP8 are emulated on sm_86;
no Marlin kernel in comfy-kitchen.

## 3. Every reader verdict

FINAL = usable as is; DRAFT = usable to pick a setting or seed, or with trims; UNUSABLE. "Nothing is FINAL" in a
scene usually means the prompt's request failed in every take (e.g. the spoken "Well?" missing in decide4), not that
the engines failed.

### decide4  (read: decide4)

| Seed | Row | Setting | Reader verdict |
|---|---|---|---|
| 1023 | A | w6a8-ck-none-4s | DRAFT, 0.0-2.6 s (before the unprompted "oh") |
| 1023 | B | int8-ck-none-4s | DRAFT, 0.0-2.6 s |
| 1023 | C | w4a4-ck-none-4s | DRAFT (weak), 1.3-2.5 s (eye smear before, nose speck throughout, navy armour) |
| 1023 | D | w4a4-ck-sol13-4s | DRAFT (weak), 1.2-2.7 s (nose speck, odd gaze, navy armour) |
| 1023 | E | int8-ck-none-8s | DRAFT, 0.0-2.6 s |
| 1023 | F | w4a8-ck-none-4s | DRAFT (weak), 0.9-2.8 s (streak 0.2-0.8 s, lantern sparkle after 3.5 s) |
| 1023 | G | int8-ck-sol13-8s | DRAFT, 0.0-2.4 s |
| 1023 | H | int8-ck-sol13-4s | DRAFT, 0.0-2.4 s |
| 1023 | I | int8-ck-sol20-4s | DRAFT, 0.0-3.1 s |
| - (read with 1023) | Z1 | FreeVideo cfv-decide4-s1061 | DRAFT, 0.0-2.6 s |
| - (read with 1023) | Z2 | FreeVideo cfv-decide4-s1062 | DRAFT, 0.0-2.7 s |
| 1024 | A | w6a8-ck-none-4s | DRAFT |
| 1024 | B | int8-ck-none-4s | DRAFT |
| 1024 | C | w4a4-ck-none-4s | UNUSABLE |
| 1024 | D | w4a4-ck-sol13-4s | UNUSABLE |
| 1024 | E | int8-ck-none-8s | DRAFT |
| 1024 | F | w4a8-ck-none-4s | DRAFT |
| 1024 | G | int8-ck-sol13-8s | DRAFT |
| 1024 | H | int8-ck-sol13-4s | DRAFT |
| 1024 | I | int8-ck-sol20-4s | DRAFT |
| - (read with 1024) | Z1 | FreeVideo cfv-decide4-s1061 | DRAFT (weak) |
| - (read with 1024) | Z2 | FreeVideo cfv-decide4-s1062 | DRAFT |

### fish1take  (read: fish1take.md)

| Seed | Row | Setting | Reader verdict |
|---|---|---|---|
| 1024 | A | int8-ck-sol13-4s (guide kf-fish-mid-c @70) | DRAFT |
| 1023 | A | int8-ck-sol13-4s (guide kf-fish-mid-c @70) | DRAFT |
| 1024 | B | int8-ck-none-8s (guide kf-fish-mid-c @70) | DRAFT |
| 1023 | B | int8-ck-none-8s (guide kf-fish-mid-c @70) | DRAFT (stutter 3.1-3.6 s) |
| - | Z1 | FreeVideo cfv-fishfl3-s1161 | UNUSABLE (torso-sized fish) |
| - | Z2 | FreeVideo cfv-fishfl3-s1162 | UNUSABLE (costume change, giant fish, roar) |
| - | Z3+Z4 | FreeVideo cfv-fishM1-s1174 + cfv-fishM2-s1172 | DRAFT (seam must be trimmed) |

### hookfl2  (read: hookfl2)

| Seed | Row | Setting | Reader verdict |
|---|---|---|---|
| 1023 | A | w6a8-ck-none-4s | DRAFT |
| 1023 | B | int8-ck-sol20-4s | DRAFT |
| 1023 | C | int8-ck-none-8s | DRAFT |
| 1023 | D | w4a4-ck-sol13-4s | UNUSABLE |
| 1023 | E | int8-ck-sol13-4s | DRAFT |
| 1023 | F | w4a4-ck-none-4s | UNUSABLE |
| 1023 | G | int8-ck-none-4s | FINAL (with the same missing blink as all) |
| 1023 | H | w4a8-ck-none-4s | FINAL |
| 1023 | I | int8-ck-sol13-8s | DRAFT |
| - (read with 1023) | Z1 | FreeVideo cfv-hookfl2-s1141.mp4 | DRAFT |
| - (read with 1023) | Z2 | FreeVideo cfv-hookfl2-s1142.mp4 | DRAFT |
| 1024 | A | w6a8-ck-none-4s | DRAFT |
| 1024 | B | int8-ck-sol20-4s | DRAFT (trim 2.45-2.6 s plume) |
| 1024 | C | int8-ck-none-8s | DRAFT (best of A-I, picture near-FINAL, snarl is wide) |
| 1024 | D | w4a4-ck-sol13-4s | UNUSABLE (style mismatch) |
| 1024 | E | int8-ck-sol13-4s | DRAFT (trim plume) |
| 1024 | F | w4a4-ck-none-4s | UNUSABLE (style mismatch) |
| 1024 | G | int8-ck-none-4s | DRAFT (trim plume, mottled head 1.5-1.9 s) |
| 1024 | H | w4a8-ck-none-4s | DRAFT (most detail; small orange patch at 2.5 s) |
| 1024 | I | int8-ck-sol13-8s | DRAFT |
| - (read with 1024) | Z1 | FreeVideo cfv-hookfl2-s1141.mp4 | DRAFT (picture) |
| - (read with 1024) | Z2 | FreeVideo cfv-hookfl2-s1142.mp4 | DRAFT |

### k1clip  (read: k1clip.md)

| Seed | Row | Setting | Reader verdict |
|---|---|---|---|
| 1023 | A | routeaC int8 dense 8s, no mid guide | DRAFT |
| 1024 | A | routeaC int8 dense 8s, no mid guide | DRAFT |
| 1023 | B | routeaC_k1clip int8 dense 8s, 5-frame guide clip (ra-a-s3101 frames 34-38) at 34 | DRAFT |
| 1024 | B | routeaC_k1clip int8 dense 8s, 5-frame guide clip (ra-a-s3101 frames 34-38) at 34 | UNUSABLE as is (ghost double); DRAFT if cut at 2.0 s |
| 1023 | C | routeaC_k1 int8 dense 8s, single K1 still at 38 | UNUSABLE |
| 1024 | C | routeaC_k1 int8 dense 8s, single K1 still at 38 | UNUSABLE |
| - | Z3+Z4 | FreeVideo Z3 + Z4 | DRAFT |

### orbit  (read: orbit.md)

| Seed | Row | Setting | Reader verdict |
|---|---|---|---|
| 1023 | A | int8-ck-none-8s | DRAFT |
| 1023 | B | int8-ck-sol13-4s | DRAFT |
| 1023 | C | w4a4-ck-sol13-4s | UNUSABLE |
| 1023 | D | int8-ck-none-4s | DRAFT |
| 1024 | A | int8-ck-none-8s | DRAFT |
| 1024 | B | int8-ck-sol13-4s | UNUSABLE |
| 1024 | C | w4a4-ck-sol13-4s | UNUSABLE |
| 1024 | D | int8-ck-none-4s | UNUSABLE |
| - | Z1 | FreeVideo cfv-h3x-orbit-s2101 | FINAL (provisional, see caveats) |
| - | Z2 | FreeVideo cfv-h3x-orbit-s2102 | DRAFT |

### orbitT2V  (read: orbitT2V.md)

| Seed | Row | Setting | Reader verdict |
|---|---|---|---|
| 1023 | A | int8-ck-none-8s | DRAFT (silver armour, two masks) |
| 1023 | B | int8-ck-sol13-8s | DRAFT (grey plate, two masks) |
| 1023 | C | int8-ck-sol13-4s | FINAL (caveat: mask on both shoulders) |
| 1023 | D | int8-ck-none-4s | FINAL (caveat: two masks, hip dagger) |
| 1023 | E | w4a4-ck-sol13-4s | UNUSABLE |
| 1024 | A | int8-ck-none-8s | DRAFT (silver armour, nose line) |
| 1024 | B | int8-ck-sol13-8s | DRAFT |
| 1024 | C | int8-ck-sol13-4s | FINAL (caveat: extra nose-bridge scar line) |
| 1024 | D | int8-ck-none-4s | DRAFT (unrequested circlet) |
| 1024 | E | w4a4-ck-sol13-4s | UNUSABLE |

### q4run2  (read: q4run2.md)

| Seed | Row | Setting | Reader verdict |
|---|---|---|---|
| 1023 | A | run2 w4a8bf-ck-none-4s | DRAFT |
| 1023 | B | run2 int8-ck-none-4s | DRAFT (best of seed) |
| 1023 | C | run2 w4a4bf-ck-sol13-4s | UNUSABLE |
| 1023 | D | run2 w4a4-ck-none-4s | UNUSABLE |
| 1023 | E | run2 w4a4bf-ck-none-4s | UNUSABLE |
| 1024 | A | run2 w4a8bf-ck-none-4s | DRAFT |
| 1024 | B | run2 int8-ck-none-4s | DRAFT (best overall; closest to FINAL) |
| 1024 | C | run2 w4a4bf-ck-sol13-4s | UNUSABLE |
| 1024 | D | run2 w4a4-ck-none-4s | UNUSABLE |
| 1024 | E | run2 w4a4bf-ck-none-4s | UNUSABLE |

### q4zoomB2  (read: q4zoomB2.md)

| Seed | Row | Setting | Reader verdict |
|---|---|---|---|
| 1023 | A | zoomB2 w4a8bf-ck-none-4s | DRAFT |
| 1023 | B | zoomB2 int8-ck-none-4s | DRAFT (best of seed) |
| 1023 | C | zoomB2 w4a4bf-ck-sol13-4s | UNUSABLE |
| 1023 | D | zoomB2 w4a4-ck-sol13-4s | UNUSABLE |
| 1023 | E | zoomB2 w4a4bf-ck-none-4s | UNUSABLE |
| 1024 | A | zoomB2 w4a8bf-ck-none-4s | DRAFT (weak) |
| 1024 | B | zoomB2 int8-ck-none-4s | DRAFT |
| 1024 | C | zoomB2 w4a4bf-ck-sol13-4s | UNUSABLE |
| 1024 | D | zoomB2 w4a4-ck-sol13-4s | UNUSABLE |
| 1024 | E | zoomB2 w4a4bf-ck-none-4s | UNUSABLE (best of C/D/E) |

### redress  (read: redress.md)

| Seed | Row | Setting | Reader verdict |
|---|---|---|---|
| - | SOURCE | FreeVideo source take cfv-h3x-run2-base-s1024 | DRAFT |
| 1023 | A | int8-ck-sol13-4s-cn1.0 | UNUSABLE (as a re-dress) |
| 1023 | B | int8-ck-none-8s-cn0.6 | DRAFT |
| 1023 | C | int8-ck-sol13-4s-cn0.6 | UNUSABLE (as a re-dress) |
| 1023 | D | int8-ck-none-8s-cn1.0 | DRAFT |
| 1024 | A | int8-ck-sol13-4s-cn1.0 | UNUSABLE (as a re-dress) |
| 1024 | B | int8-ck-none-8s-cn0.6 | DRAFT |
| 1024 | C | int8-ck-sol13-4s-cn0.6 | UNUSABLE (as a re-dress) |
| 1024 | D | int8-ck-none-8s-cn1.0 | DRAFT |

### routeaC_all  (read: routeaC)

| Seed | Row | Setting | Reader verdict |
|---|---|---|---|
| 1023 | A | k1guide-int8-ck-sol13-4s | DRAFT |
| 1023 | B | noguide-int8-ck-sol13-8s | FINAL (trim end hold; K1 not hit) |
| 1023 | C | noguide-w4a4-ck-sol13-4s | UNUSABLE |
| 1023 | D | k1guide-int8-ck-none-8s | UNUSABLE as one shot (two hard cuts); three usable stills/segments 0-0.79, 0.83-2.54, 2.58-3.75 |
| 1023 | E | noguide-int8-ck-sol13-4s | FINAL |
| 1023 | F | noguide-int8-ck-none-4s | FINAL |
| 1023 | G | noguide-int8-ck-none-8s | FINAL |
| - (read with 1023) | Z1 | FreeVideo ra-c-s3301.mp4 | DRAFT |
| - (read with 1023) | Z2 | FreeVideo ra-c-s3302.mp4 | DRAFT |
| - (read with 1023) | Z3+Z4 | FreeVideo ra-a-s3101.mp4 + ra-b-s3201.mp4 | DRAFT (fixable at the seam) |
| 1024 | A | k1guide-int8-ck-sol13-4s | UNUSABLE as one shot |
| 1024 | D | k1guide-int8-ck-none-8s | UNUSABLE as one shot |
| 1024 | B | noguide-int8-ck-sol13-8s | DRAFT |
| 1024 | C | noguide-w4a4-ck-sol13-4s | UNUSABLE |
| 1024 | E | noguide-int8-ck-sol13-4s | DRAFT |
| 1024 | F | noguide-int8-ck-none-4s | DRAFT |
| 1024 | G | noguide-int8-ck-none-8s | DRAFT |
| - (read with 1024) | Z1 | FreeVideo ra-c-s3301.mp4 | DRAFT (near FINAL) |
| - (read with 1024) | Z2 | FreeVideo ra-c-s3302.mp4 | DRAFT (near FINAL) |
| - (read with 1024) | Z3+Z4 | FreeVideo ra-a-s3101.mp4 + ra-b-s3201.mp4 | FINAL candidate, with the join fixed |

### run2  (read: run2)

| Seed | Row | Setting | Reader verdict |
|---|---|---|---|
| 1023 | A | w4a8-ck-none-4s | DRAFT (weak) |
| 1023 | B | int8-ck-none-8s | DRAFT |
| 1023 | C | w4a4-ck-none-4s | UNUSABLE |
| 1023 | D | w6a8-ck-none-4s | DRAFT (weak) |
| 1023 | E | int8-ck-sol13-8s | DRAFT (best of A-I) |
| 1023 | F | w4a4-ck-sol13-4s | UNUSABLE |
| 1023 | G | int8-ck-none-4s | DRAFT |
| 1023 | H | int8-ck-sol13-4s | DRAFT |
| 1023 | I | int8-ck-sol20-4s | DRAFT |
| - (read with 1023) | Z1 | FreeVideo cfv-h3x-run2-base-s1023 | DRAFT (not scored by me as FINAL: lantern and bow in one hand ~2.3 s; red scarf instead of cloak late) |
| - (read with 1023) | Z2 | FreeVideo cfv-h3x-run2-base-s1024 | DRAFT |
| 1024 | A | w4a8-ck-none-4s | DRAFT |
| 1024 | B | int8-ck-none-8s | DRAFT |
| 1024 | C | w4a4-ck-none-4s | UNUSABLE |
| 1024 | D | w6a8-ck-none-4s | DRAFT |
| 1024 | E | int8-ck-sol13-8s | DRAFT |
| 1024 | F | w4a4-ck-sol13-4s | UNUSABLE |
| 1024 | G | int8-ck-none-4s | DRAFT |
| 1024 | H | int8-ck-sol13-4s | DRAFT |
| 1024 | I | int8-ck-sol20-4s | DRAFT |
| - (read with 1024) | Z1 | FreeVideo cfv-h3x-run2-base-s1023 | DRAFT (costume wrong) |
| - (read with 1024) | Z2 | FreeVideo cfv-h3x-run2-base-s1024 | DRAFT (costume wrong) |

### run2tv  (read: run2tv.md)

| Seed | Row | Setting | Reader verdict |
|---|---|---|---|
| 1023 | A | int8-ck-none-4s | DRAFT |
| 1023 | B | w4a4-ck-sol13-4s | UNUSABLE |
| 1023 | C | int8-ck-none-8s | DRAFT |
| 1023 | D | int8-ck-sol13-4s | DRAFT |
| 1024 | A | int8-ck-none-4s | DRAFT (weak) |
| 1024 | B | w4a4-ck-sol13-4s | UNUSABLE |
| 1024 | C | int8-ck-none-8s | DRAFT (best letter) |
| 1024 | D | int8-ck-sol13-4s | DRAFT |
| - | Z1 | FreeVideo cfv-h3x-run2-tv-s1023 | DRAFT |
| - | Z2 | FreeVideo cfv-h3x-run2-tv-s1024 | DRAFT |

### trust2  (read: trust2)

| Seed | Row | Setting | Reader verdict |
|---|---|---|---|
| 1023 | A | int8-ck-sol20-4s | DRAFT |
| 1023 | B | int8-ck-none-8s | DRAFT |
| 1023 | C | w4a4-ck-sol13-4s | UNUSABLE |
| 1023 | D | int8-ck-sol13-4s | DRAFT |
| 1023 | E | int8-ck-sol13-8s | DRAFT (nearest to FINAL of A-I) |
| 1023 | F | w6a8-ck-none-4s | DRAFT |
| 1023 | G | w4a8-ck-none-4s | DRAFT |
| 1023 | H | int8-ck-none-4s | DRAFT |
| 1023 | I | w4a4-ck-none-4s | UNUSABLE |
| - (read with 1023) | Z1 | FreeVideo cfv-trust2-s848 | DRAFT |
| - (read with 1023) | Z2 | FreeVideo cfv-trust2-s849 | DRAFT (strongest clip of the eleven, near FINAL) |
| 1024 | A | int8-ck-sol20-4s | DRAFT (weak) |
| 1024 | B | int8-ck-none-8s | DRAFT |
| 1024 | C | w4a4-ck-sol13-4s | UNUSABLE (no fish, smeared) |
| 1024 | D | int8-ck-sol13-4s | DRAFT |
| 1024 | E | int8-ck-sol13-8s | DRAFT |
| 1024 | F | w6a8-ck-none-4s | DRAFT |
| 1024 | G | w4a8-ck-none-4s | DRAFT |
| 1024 | H | int8-ck-none-4s | DRAFT (best of the set) |
| 1024 | I | w4a4-ck-none-4s | UNUSABLE |
| - (read with 1024) | Z1 | FreeVideo cfv-trust2-s848 | DRAFT, roaring beast and loud |
| - (read with 1024) | Z2 | FreeVideo cfv-trust2-s849 | DRAFT |

### zoomB2  (read: zoomB2.md)

| Seed | Row | Setting | Reader verdict |
|---|---|---|---|
| 1023 | A | int8-ck-none-4s | DRAFT |
| 1023 | B | w4a4-ck-sol13-4s | UNUSABLE |
| 1023 | C | int8-ck-none-8s | DRAFT |
| 1023 | D | int8-ck-sol13-4s | DRAFT |
| 1024 | A | int8-ck-none-4s | DRAFT |
| 1024 | B | w4a4-ck-sol13-4s | UNUSABLE |
| 1024 | C | int8-ck-none-8s | DRAFT |
| 1024 | D | int8-ck-sol13-4s | DRAFT |
| - | Z1 | FreeVideo cfv-zoomB2-s961 | DRAFT (best, but ends on the hooded figure too) |
| - | Z2 | FreeVideo cfv-zoomB2-s965 | DRAFT (best, with Z1) |
