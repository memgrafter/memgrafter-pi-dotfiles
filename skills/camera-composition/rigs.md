# Camera outputs: H3 sentences, Godot/Blender parameters, beat-board column

Formats the `camera-composition` skill produces. Numbers marked "measured" were measured on this Mac on 2026-11-06
(Blender 5.2.3 LTS, Godot 4.7.2); everything else is cited in `catalogue.md` or report csc-pt6z.

## (a) H3 camera sentence
Grammar (MiniMax H3 prompt-writing skill §4.3, the owner's table csc-k7yv):

`The camera <motion> [with small|large amplitude] [at slow|fast speed] <toward X | revealing X | following X | as X happens>.`

- One camera action per shot, written as an action inside the description, not a label at the end (H3 §4.3; Sora 2
  guide: "one clear camera move and one clear subject action" per shot).
- Leave out amplitude/speed when they are medium/normal (H3 §4.3).
- Name the target by what it looks like, or by its reference label: "toward <Subject 1> as defined in <Picture 2>".
- A cut inside one H3 take must bring new information; for a small change of distance or angle, move the camera
  instead (H3 §4.2: "[Shot 2] At 00:03.500, the camera cuts to ...").
- Push vs zoom: H3 reads "pushes in" as a camera move. Our hook prompts that needed real parallax said it outright
  ("the camera physically pulls backward ... with strong parallax", `production/h3/prompts/`).
- Static is the most used line in our prompts ("The camera holds still.", 23 prompts on 2026-11-06). It is right when
  the action carries; it is the wrong default for a beat whose job is change.
- Camera direction words (left/right) are relative to the picture. Video-language models confuse left/right and
  translation/rotation (arXiv 2607.03043, 2610.17242), so a take-read report of camera direction needs a check by eye
  or by frame difference.

Examples (owner-style):
- "The camera pushes in with small amplitude at slow speed toward the woman's eyes as she realises the beast is listening."
- "The camera holds a static shot as the beast lowers its snout to her open left hand, on the left of the picture."
- "The camera tracks backward at fast speed in front of the woman as she sprints along the ledge, shaking slightly."
- "The camera pulls out with large amplitude at slow speed from the lantern, revealing the colossal beast above her."

## (b) Godot / Blender camera parameters

### The lens convention for 9:16 (decide once, state it every time)
Use focal length in mm on a **36 mm-tall 9:16 gate** (a full-frame sensor turned upright, cropped to 20.25 x 36 mm),
and always also write the vertical field of view (vFOV) in degrees, which is what both engines agree on:
`vFOV = 2·atan(18 / f)`, `hFOV = 2·atan(10.125 / f)`.

| f (mm) | vFOV | hFOV | conventional read |
|---|---|---|---|
| 14 | 104.3° | 71.7° | very wide: strong depth, distortion near the lens |
| 18 | 90.0° | 58.7° | wide |
| 24 | 73.7° | 45.7° | wide-normal |
| 35 | 54.4° | 32.3° | normal-wide (measured in Blender: v 54.43°, h 32.27° at 1080x1920) |
| 50 | 39.6° | 22.9° | normal |
| 85 | 23.9° | 13.6° | portrait tele: flattering faces, background compressed |
| 135 | 15.2° | 8.6° | long tele: isolation, flattening |

(The "read" column is common teaching [recall]; see catalogue, Lens.)

- **Blender:** `cam.data.lens = f`, `sensor_width = 36`, `sensor_fit = 'AUTO'` (the default). With a portrait render
  (1080x1920) AUTO fits the 36 mm to the taller side, which is this convention (measured).
- **Godot 3D (Camera3D):** set `fov` = vFOV in degrees with the default `keep_aspect = KEEP_HEIGHT` (measured: the
  default `fov` 75 gives a vertical FOV of 75.0°). Do **not** use `CameraAttributesPhysical.frustum_focal_length` for
  parity: it maps mm to a 24 mm-tall gate (measured: 35 mm gives vFOV 37.85°, not 54.4°), so "35 mm" frames tighter
  in Godot than in Blender.
- **Godot 2D shots (`production/godot-shots`, Camera2D on painted layers):** `zoom` is magnification only, so a zoom
  ratio equals a focal-length ratio (zoom 1.0 -> 2.0 = doubling f, no parallax). `dolly` adds per-layer depth scaling,
  which is what makes a push read as a push. `rail` points move the camera across the painting (truck/pedestal);
  `ease` is Godot's `ease()` curve (1 linear, 0..1 ease-out, >1 ease-in, <0 in-out).

### Shot record (one per shot; JSON)
```json
{
  "shot": "hook-eye", "role": "hook", "intent": "threat + a person in danger, read in one look",
  "fps": 30, "t0_s": 0.0, "t1_s": 1.5, "frames": 45,
  "size": "MCU", "angle": "low", "height_m": 1.2,
  "lens": {"focal_mm": 35, "gate": "36 mm tall 9:16", "vfov_deg": 54.4},
  "move": {"type": "push in", "amplitude": "small", "speed": "slow", "ease": "out",
            "hold_before_s": 0.0, "hold_after_s": 0.3},
  "keys": [{"t": 0.0, "pos": [0, 1.2, 4.0], "look_at": [0, 1.6, 0]},
           {"t": 1.2, "pos": [0, 1.25, 3.4], "look_at": [0, 1.6, 0]}],
  "continuity": {"axis": "her <-> beast, camera on the left side", "screen_dir": "she faces right"},
  "h3": "The camera pushes in with small amplitude at slow speed toward the woman's face as the beast's eyes open above her."
}
```
Times in seconds and frames at the render's fps (H3 24 fps; Godot 30 fps). Holds and move lengths come from the beat
(telegraph = hold, do = move) and are checked on the render; do not invent them.

## (c) Beat-board camera column
Add these columns to the beat board (AGENTS.md: beat, time, picture, onset, text and its hold, sound):

| beat | time | role | size | angle | lens | move (type, amp, speed) | dur s / frames | intent | contrast with previous | continuity |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.0-1.5 | hook | MCU | low | 35 mm | push in, small, slow | 1.5 / 45 | threat + person, read in one look | (first) | she faces right |
| 2 | 1.5-3.0 | progress | WS | high | 24 mm | static | 1.5 / 45 | scale: how small she is | size CU->WS, angle low->high | same side of the axis |
