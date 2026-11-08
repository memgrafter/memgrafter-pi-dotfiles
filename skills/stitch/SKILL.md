---
name: stitch
description: Get clean motion through several poses (a hand-off, something drawn from a cloak, a throw and catch) that no single H3 take gets right, using the owner's stitch technique: overlapping keyframed segments, keep the leading parts, bridge the joins. Use when a beat has objects moving between hands or appearing.
---

# The owner's stitch technique

Owner, 2026-11-05: "Whenever objects are moving around we have to interleave overlapping videos from frames, and do desired
intermediate frames, always taking the leading segments, and then we put them back together." It produced the fish
result in "what do you do?" (`cfv-fishstitch-s1182`): fishM1-s1174 0–1.8 + bridge s1182 + fishM2-s1172 from 0.4.

## When to use
- A beat where an object changes hands, appears, or flies (and a single take floats, pops or resizes it).
- Not for single-motion beats: they settled within 5 prompt versions without it.

## Steps
1. **Keyframes** (skill `keyframe`): one still at each object transition (lantern passed to the left hand; trout at the
   hip; trout in the jaws), plus a midpoint between transitions. The owner approves each still.
2. **Segments** (skill `h3-takes`): fl2va jobs between consecutive keyframes, 2 seeds each, run in parallel.
3. **Keep the leading part** of each segment: cut before it slows into its end keyframe (takes drift into the end pose
   early). Read every segment neutrally first (skill `take-read`); trim a frame-1 flash.
4. **Bridge** each join: `python3 -I stitch.py frames SEG_A@T_A SEG_B@T_B` (the last kept frame of A, and the frame of B
   that is the same story time later) extracts both frames and prints a 1.625 s fl2va job. The keyframe pose and any
   flash fall out of the result.
5. **Join**: `python3 -I stitch.py join NAME SEG_A@0-T_A BRIDGE SEG_B@T_B` -> `h3/composites/NAME.mp4` + `.json` (its parts).
   Use the composite in `videos/<video>/cut.json` by absolute path.
6. Small jumps at the joins don't show at final size (owner 2026-11-05); still show the composite alone before using it.

## Alternative: continuation
`--continue-from <unmodified H3 mp4> --continue-anchor <one picture>` (task ref2va, via a job's `extra` field) extends a take
from its own last 22 frames with no join. One anchor picture only, no `--media` references, no exact end frame; it outputs
only the new frames, so join them after the source with `stitch.py join`. Untested with the owner (fish-r21 never reviewed).
