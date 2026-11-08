---
name: camera-composition
description: Choose every shot's size, angle, lens and camera move from what the beat must make the viewer feel and where it sits in the sequence, using film-industry conventions, then write it as an H3 camera sentence, Godot/Blender camera parameters and a beat-board column. Use it whenever you plan a beat board, write an H3 prompt's camera line, block a Godot or Blender shot, or review why a draft loses viewers. It checks for the two sequence mistakes in what-do-you-do draft 30 that line up with where its viewers left (a frame 0 with no person, and the same shot repeated for 5 s).
---

# Camera composition

Pick the camera from the beat's intent and its place in the sequence, with conventional defaults first, and write
the same decision three ways: an H3 prompt sentence, engine parameters, and a beat-board row.

## Why use it
- **Defaults come from the film canon, not taste.** Each mapping (push in = growing attention, low angle = power,
  ...) cites its book in `catalogue.md`, so a deviation is a named choice, not an accident.
- **It works on the sequence, not the single shot.** Draft 30 was well made shot by shot and still lost 87% of
  viewers on frame 0, and the rest left on average at 9 s (csc-rbpw). Both conventions it broke there are sequence-level.
- **One decision, three outputs that agree.** The H3 sentence, the Godot/Blender camera and the beat board describe
  the same move, lens and timing (`rigs.md`, with measured lens conversions).

## When to use
- Building or revising a beat board or storyboard (before keyframes; the owner approves the board first).
- Writing the camera line of an H3 prompt (`h3-takes`), or a keyframe's framing (`keyframe`).
- Blocking a Godot (`production/godot-shots`) or Blender shot.
- Reviewing a draft that loses viewers, or a take whose camera "feels wrong" (pair with `take-read`).

## When NOT to use
- Fixing an object's size, hands or an end pose: that is `keyframe` (H3 won't get these from camera words).
- Joining segments: `stitch`. Building a draft: `short-draft`.
- As proof that a shot will retain viewers: the canon gives conventions, not audience data. Only posted numbers
  (like csc-rbpw) are evidence for our audience.

## Decision procedure (in this order)
1. **Role in the sequence.** Mark the beat: hook (frame 0), establish, progress, climax, release, payoff, end card.
   Write its one intent in plain words ("she is in danger and the beast is huge", "the choice: fight").
2. **Shot size and angle** from the intent (catalogue, layer 2): emotion -> CU; orientation/scale -> wide; power ->
   low angle; vulnerability -> high angle; relationship -> OTS/2-shot. Hook: one readable subject, a person or face
   if the story has one.
3. **Lens** (mm on the 36 mm-tall 9:16 gate, plus vFOV): wide for space and speed, long for isolation and
   compression, normal by default (`rigs.md`).
4. **Contrast with the neighbours.** Change at least one of size, angle, side or move from the previous shot unless
   affinity is the point (Block, contrast & affinity). Never repeat the same size + angle + composition in two
   consecutive beats with only a caption changing.
5. **Motion, amplitude, speed, duration.** Static unless a move adds meaning (motivated movement). Move after the
   motivating action starts, begin and end on a settled frame (Grammar of the Edit, PIP #10), pans no faster than
   ~1 frame width per 7 s unless it is a whip (RED). Duration from the beat (telegraph = hold, do = move [ours]).
6. **Continuity check.** One side of the line of action (Arijon, triangle principle; GE PIP #8), screen direction kept
   across cuts (GE PIP #9), eyelines matching, no pan reversing direction across a cut (GE PIP #11), a re-orienting wide
   after a run of close-ups (GE PIP #2).
7. **Short-form check (9:16).** Frame 0 carries the hook; first motion onset and sound by ~0.3 s; a new picture about
   every 1.5-2 s; every caption holds >= 0.6 s + 0.3 s per word and sits in the safe box (x 120-888, y 288-1248; below
   y 840 keep left of x 780; research/tiktok-instagram).
8. **Write the three outputs** (`rigs.md`) and name every deviation from a convention with its reason in the beat
   board's intent column.

## Layer 3: the shot in the whole composition
- **Establish -> progress -> payoff.** A sequence conventionally opens on orientation, tightens as tension rises, and
  returns wide to release or reveal (Katz ch 6-7; Grammar of the Edit PIP #2, #4). In a short, the hook replaces the
  slow establish: orientation and the question have to be in frame 0.
- **Intensity is structured by contrast.** More contrast between shots (size, angle, direction, speed, tone) raises
  visual intensity; affinity lowers it (Block ch 2, 9). Put the most contrast where the story peaks, never put a run
  of affinity in the middle of a short.
- **Cut for a reason and for new information** (Grammar of the Edit ch 5 and ch 8: "A New Shot Should Contain New
  Information"; H3 §4.2). Rank cutting reasons by emotion, story, rhythm, eye-trace, then 2D/3D continuity (Murch,
  rule of six).
- **Move-to-cut.** Cut after the movement settles or on matched action (Arijon, "Cutting after the movement"; GE ch 6
  PIP #7). A cut lands on the strongest new image; a whip pan is a built-in cut point (GE ch 6 PIP #3).
- **Onsets beat drifts.** A motion onset captures attention; motion that is already going does not
  (research/tiktok-virality, ref 44). A slow camera drift is not a hook: put an onset (a turn, a flare, an entry, a
  cut) in the first ~0.3 s and in every beat.

## Anti-patterns (with the real case)
| Anti-pattern | Draft 30 (what-do-you-do, YouTube Shorts) | Convention broken | Do instead |
|---|---|---|---|
| Frame 0 with no person and no context | 0 s: a full-screen dragon-eye ECU, no person, no text (caption starts at 0.125 s); 87% swiped away immediately (csc-rbpw) | ECU strips context (Me "Extreme close-up", "Abstract shot"); faces are found in 0.10-0.14 s and help (tiktok-virality §2) | Frame 0 = the person and the threat together (MCU/MS, low angle), or the eye with her in it |
| A reveal that pays off after the decision window | The hook prompt pulls back from the eye; she is revealed at ~4 s of a single 5.0 s shot | Pull-out reveals need time to pay off (GE PIP #8: motivate dolly-outs) | Reveal by cut, or start wide enough that the payoff is in frame 0, then push in |
| The same shot repeated with only the word changing | 7.7 s to about 14 s: all four options (FIGHT, BEFRIEND, HIDE, RUN) open on the same wide frame from behind her, looking up at the beast; only the caption word and her action change. Viewers left on average at 9 s | A new shot should contain new information (GE ch 8); affinity lowers intensity (Block ch 2) | Keep the shared start frame for one beat only, then give each option its own size/angle/move |
| Long single shot in a short | Hook is one 5.0 s shot | New picture every ~1.5-2 s [owner] | Cut the hook into 2-3 pictures, or add onsets inside the shot |
| Camera drift as the only motion | (Godot riffs, by design) | Onset rule above | Add a subject onset or a cut |

Caution on cause: the draft 30 numbers are one post, and these breaks line up with where viewers left but do not
prove they caused it [ours]. Test changes against draft 30 when the owner posts again.

## Examples
- **Hook for a choice short:** "MCU, low angle, 35 mm, push in small and slow, 0-1.5 s, intent: she is small and the
  beast is right above her; contrast: (first)". H3: "The camera pushes in with small amplitude at slow speed toward
  the woman's face as the beast's amber eyes open in the dark above her."
- **Options beat (each 1.5 s):** FIGHT = low angle CU on the drawn bowstring, push in fast; BEFRIEND = OTS from behind
  the beast toward her open left hand, static; HIDE = high angle WS, pull out slow as she snuffs the lantern; RUN =
  tracking backward fast, shaking slightly. Same story moment, four different pictures.

## Output
For each beat: the beat-board row, the H3 camera sentence, and (for Godot/Blender shots) the shot record JSON with
lens in mm and vFOV, keys in seconds and frames, easing and continuity notes. Formats and examples: `rigs.md`.

## How it works
Layer 1 primitives (motion, amplitude, speed, duration, easing, holds, lens, size, angle, height) and layer 2 intents
live in `catalogue.md` with their sources; layer 3 (sequence, cutting, continuity, 9:16 pacing, anti-patterns) is
above. Research behind it: report ticket csc-pt6z. Cost: a few minutes per beat board and a longer board. Benefit:
camera choices that can be defended by source, agree across H3, Godot and Blender, and avoid the two failures we have
real audience data on.
