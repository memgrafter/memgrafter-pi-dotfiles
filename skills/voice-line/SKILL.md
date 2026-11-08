---
name: voice-line
description: Make a character's spoken line in the owner's chosen voice (Crimson Frost = Audio8 s18, 30% faster) with a Whisper check, in one command, instead of rediscovering the TTS setup (the owner had to remind the agent of Crimson Frost's voice on 2026-11-05).
---

# Voice lines

## When to use
- Any spoken line for Crimson Frost or Ash in a short.
- Not for sound effects (`/Volumes/ExternalData/social-content/sfx-real`, CC0, real recordings only).

## Run
```bash
python3 -I production/tools/vo.py crimson <out-name> "well|Well?" "wdyd|What do you do?" [--seeds 103,104,105]
```
- Crimson Frost: Audio8-TTS-Realistic-0.6b (on this Mac) with `cast/cast-s18.wav` as the reference (owner's final voice);
  Ash: `ash`, seed 211, no reference. Both: silence trimmed, `atempo=1.3` (owner: "30% faster is best").
- Takes land in `/Volumes/ExternalData/social-content/voicelines/<out-name>/fast30/`; review copies in
  `h3/review/tests/voice-<out-name>/`. The command prints each take's length, Whisper large-v3 text and per-word confidence.
- About 30 s for one line and one seed (2026-11-05).

## Choosing
- Drop any take whose Whisper text differs from the line. Prefer the highest word confidence, then listen.
- Bare lines read as questions ("Well?"); padding ("So... well?") read flat.
- Seed 103 was the pick for all three lines in "what do you do?".
- The owner picks by ear: send the review folder path with the takes numbered.

## In the mix
Add a cue to `videos/<video>/sound.json` with the fast take as `src`, and dip the beds about 4 dB under it (`duck`) so the
sounds stay behind the voice (owner: "keep the sounds behind"). Check it with Whisper on the final mix window.
