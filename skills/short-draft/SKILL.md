---
name: short-draft
description: Build, check and hand over a draft of an H3 short so nothing gets lost between drafts (the "Well?" line vanished once) and the owner always knows what is new, what changed and what to watch. One command builds picture and sound from a video's config files and records exactly what built it.
---

# Drafts of a short

Every draft comes from `production/h3/make_draft.py` and a video's two config files. On 2026-11-05 drafts built other ways
lost cues "out the side", and the owner had to ask "what changed since I left", "did you actually make a draft", "what can
I review". This skill removes those questions.

## When to use
- Any change to a short's picture or sound that the owner will watch.
- Not for one-beat previews or effect tests: those go in `h3/review/tests/<what-it-tests>/`, with the frames used.

## Files
- `production/h3/videos/<video>/cut.json`: every picture setting (shots and source windows, tiles, face-off split,
  transitions, labels, captions, grade, end cards, QR). Notes are in its `_`-prefixed keys.
- `production/h3/videos/<video>/sound.json`: the cue sheet; field reference in `mix.py`'s docstring.
- `cut_options.py`: builder for the four-options format (hook, face-off, four options parked into a 2×2, end card). A video
  in a different format needs its own builder; keep its settings in `videos/<video>/` the same way.
- A new video: copy `videos/what-do-you-do/` to `videos/<new>/`, set `name`, then edit.

## Build
```bash
cd production/h3
python3 -I make_draft.py draftNN [video=<video>] [endcard=D] [qr=tik|igr|yt|tw|fnf] [transition=park] [SHOT=clip:in]
```
- Draft numbers only go up; the owner names variants (e.g. `draft31-tik`). Commit config and code changes first, so the
  record's commit is clean (`uncommitted_changes: false`).
- Output: `h3/review/<video>-draftNN.mp4` + `.json` (commit, args, picture config, cue sheet, timeline, loudness,
  `changes_since` the previous draft). The command prints the change list.
- Rule check (automatic, warning only): `production/tools/draft_check.py` runs on every draft and prints its FAIL/WARN
  lines; `h3/review/<video>-draftNN-check/` holds `check.json` and `phone-sheet.png` (frames at 360 px). It never stops a
  build. `end-card line hold` breaks are listed apart: whether end-card lines count as captions is the owner's call.
- Byte-identical rebuilds (opt-in): `bitexact=on` renders mograph frames as PNG (`bin/mograph-next --frames`) and encodes
  with ffmpeg libx264 bitexact (BT.709); the sound is muxed bitexact. Same commit, config, sources and Mac -> same mp4
  bytes. About 62 s per build instead of about 18 s (csc-xlky, Apple M6). Off by default.
- Test builds that must not reach the owner's review folder: `root=/Volumes/ExternalData/social-content/h3/review/tests/<name>`.
- Per-platform versions differ only by the QR code: build one per campaign (`qr=<p>`), decode each QR from the last
  frame before handing over (`swift production/tools/qrread.swift FRAME.png`).

## Check before telling the owner (take-read skill, "Drafts")
0. Read the rule-check lines make_draft printed and look at the phone sheet; fix or name every FAIL in the hand-over.
1. Storyboard read of the picture (Sonnet, neutral brief, given the timeline file, not a description).
2. Sound: ebur128 on the mp4 (target about −14 LUFS, true peak under −1 dBTP), a 200 Hz high-pass listen for phones,
   every voice line heard at its cue.
3. The end card: the 18+ disclosure "18+ · Characters, voices and video are machine-generated" in the last 0.5 s
   (repo AGENTS.md, 2026-10-30), QR decodes.

## Hand over (always this shape)
- **Ready for you:** numbered items, each an exact path, with the change list from `make_draft` in plain words.
- **Still being worked on:** what, and where it will land.
- **Waiting on you:** each decision with the options and a recommendation.
Show takes and keyframes one at a time, never in grids. Nothing for review goes in `/tmp`.
