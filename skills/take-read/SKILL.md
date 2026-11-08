---
name: take-read
description: Catch the AI-video failures the owner would catch (floating lanterns, a hand catching fire, a fish popping in) before the owner sees a take or a draft. A neutral frame-by-frame read by a Sonnet agent, with a fixed brief and failure list. Use on every H3 take before it is used or shown, and on every draft before handing it over.
---

# Neutral take and draft reads

On 2026-11-05 a reader that was told the intended choreography passed a hide in which Crimson Frost's hand catches fire and smoke
came from Crimson Frost's mouth. The owner: "Did you use agents to read the storyboards after making this?" A reader that is not
told the intent describes what is really there. This skill is that reader, with the brief written once.

## When to use
- Every H3 take, after `h3.py pull` and before it goes into a cut or in front of the owner.
- Every draft, before telling the owner it is ready (with the sound read below).
- Every FLUX keyframe before an H3 run uses it (a quick look of your own is enough for stills).

## Tool
```bash
python3 -I production/h3/frames.py VIDEO OUTDIR [--fps 12] [--from S --to S] [--crop W:H:X:Y]
```
Frames, labelled contact sheets (`sheet-NN.png`), `frames.tsv` (time, luma, luma change: flashes and cuts show as big
jumps) and `info.json`. 12 fps over the whole take, then 24 fps (`--fps 24 --from --to`) and full-resolution crops
around hands, held objects, faces, mouths and any moment that matters.

## The agent
One agent per batch of takes: `subagent_type: general-purpose`, `model: sonnet` (Sonnet 5.5 at high effort reads
images best; owner 2026-11-05). For editorial judgement on a whole draft, add one `model: fable` read.
Brief (fill in the brackets; NEVER describe what is supposed to happen as a fact):

> You are a neutral, skeptical frame reader for AI-generated video clips. Do NOT spawn subagents, use no Agent/Task tool
> and no workflows; do everything yourself. Write scratch output only under [/tmp/fr-NAME]; modify nothing else.
> Clips: [paths]. For each clip run `python3 -I [repo]/production/h3/frames.py CLIP [/tmp/fr-NAME/<take>]`, read the
> contact sheets with the Read tool, then use `--fps 24 --from --to` and `--crop` for full-resolution detail wherever a
> person, hand, held object, face, mouth or text is involved. Check `frames.tsv` for luma jumps (flashes, cuts).
> 1. Describe, range by range with timestamps, exactly what you SEE: what each hand does, what each hand holds at every
>    moment, every object's position, size and colour, the person's face, hood and clothing, the creature's actions and
>    expression, the camera move, the lighting.
> 2. Answer these questions (they are questions, not claims): [the beat's checks, e.g. "Is the lantern held by a hand at
>    every moment?", "Where does the fish first appear, and is it visible before that?", "Does the creature close its
>    mouth on anything?"].
> 3. Go through the failure list below and report every item you find, with timestamps, however small.
> 4. Audio: `EARSHOT_HOME=/Volumes/ExternalData/earshot/home HF_HUB_OFFLINE=1 /Volumes/ExternalData/virtualenvs/earshot/bin/earshot describe FILE.wav`
>    on each clip's audio (cut with ffmpeg); report roars, speech, music, whistles.
> 5. Finish with: for each clip, the longest window with no failures (start-end s), the best clip, and anything that
>    makes a clip unusable. If none is usable, say so plainly. Be blunt; assume nothing is intended.

## Failure list (add every new H3 failure here, with the date)
| Failure | What it looks like |
|---|---|
| Floating object | a held object (lantern, bow, fish) stays in the air with no hand on it |
| Pop-in / pop-out | an object, bag or garment appears or vanishes between frames |
| Ghost double | a second translucent person or limb, double exposure |
| Morph | hair becomes a hood, a hand becomes a blob, a fish becomes a white streak |
| Identity swap | costume, armour colour, face or build changes mid-shot (gold armour in the run, 2026-11-05) |
| Wrong size | an object with no keyframe comes out huge (the trout larger than Crimson Frost's torso) |
| Fire / smoke | fire on hands or clothes, smoke or breath from the mouth |
| Wet | water dripping from a bag, drool from the creature |
| Roar | the creature roars or bares fangs in a calm beat |
| Early end pose | the take drifts into its last keyframe pose too soon, or darkens before the light goes out |
| Frame-1 flash | a bright or blue flash on the first frames (fl2va); trim it |
| Hood flip | the hood goes up or down with no hand pulling it |
| Side swap | hands or the held object swap sides |
| Text / numbers | letters, numbers or quotes drawn in the picture |

## Drafts: the storyboard check
Before telling the owner a draft is ready: one Sonnet read of the picture against the beat board (cuts, captions,
labels, the end card, the 18+ disclosure in the last 0.5 s), and one sound read (loudness with ffmpeg ebur128 on the mp4,
a 200 Hz high-pass for phone speakers, every cue in the cue sheet heard at its time, the voice lines intelligible).
Give the readers the timeline file for times, never a description of what the shots show.
