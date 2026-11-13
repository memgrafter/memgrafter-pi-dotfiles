---
name: reference-face
description: Pick a character's reference face, and check that later pictures still show that face, with numbers a program computes (a same-person score from face recognition, make-up colours, face points) instead of an agent's opinion. Use it when choosing or correcting the face in a reference panel, when ranking face candidates before the owner picks, and when a picture or video frame "doesn't look like her". On the first run the owner's blind pick was the top-scoring candidate.
---

# Reference face by measurement

Measure faces against the owner's art, rank candidates, let the owner pick blind, then carry the picked face to every
view. Repo: `characteragent.ai-social-content`. Full method, numbers and evidence: `report.md` beside this file.

## Why use it
- **It says what is different and by how much.** "Lips paler, brows lighter" became lips 17-25 against the key art's
  36-39. An agent reviewer could not give that, and its opinion moved with the brief.
- **It ranked the way the owner's eye did.** Crimson Frost, 2026-11-12: four candidates, the owner picked 701 blind,
  701 had the top score (0.677; the panel's old face 0.487). One agreement in one try: a ranking, not yet a pass mark.
- **No agent step and no GPU.** It runs on the Mac in under a minute for ten faces, on any picture with one face.

## When to use
- Choosing or correcting the face of a character's reference panel (a human or human-like face).
- Ranking face candidates before they go to the owner.
- Checking panel views, stills or video frames for a face that has drifted from the master.

## When NOT to use
- As the decision. The owner picks the master and accepts the views; the score only ranks.
- Across different light, head turn or style: light alone moved the score by 0.18. Compare like with like.
- Profiles and back views (no face is found), and creatures (the models are for human faces).
- For anything but the face. Uniform, key items and the room have their own checks (`character_panel.py check`).

## Procedure
`PY` = `/Volumes/ExternalData/audio8/venv/bin/python -I`; `CV` = `/Volumes/ExternalData/code/conjure3d-character-venv/bin/python -I`;
run from the repo root. `NAME` = the character's file `production/imagegen/characters/NAME.json`.

1. **Set up the `face` region** in the character's file: `box` (the face in a panel view), `source` (the owner's art,
   the face's box in it, and `cast_patch`: a patch of the art that should be grey, used to take the art's coloured
   light off), `pair: one-sided` (a face is never flipped), `wording`.
2. **Measure the art and the panel:** `CV production/imagegen/face_look.py OUT --character NAME CONFIG`. Read the
   table `OUT/face-look.md`: which panel view has the art's head turn (that view is `flat_on`: the master is made
   there), and where the panel differs. To see it by eye: `PY production/imagegen/character_panel.py NAME sheet face --source-light`.
3. **Show the owner the reference** (`OUT/source-cast-off.png`) before making anything from it.
4. **Make master candidates at the panel's full size** (four seeds):
   `PY production/imagegen/character_panel.py NAME swap ROUND SEEDS face ref=OUT/source-cast-off.png:right:0,0,W,H CONFIG:AZ:right > production/h3img/jobs/ROUND.json`
   (`right`/`left` = the picture edge the face looks toward; the same in the art and the view). Run it on vert as in
   `production/h3img/README.md`.
5. **Measure the candidates:**
   `PY production/imagegen/character_panel.py NAME check production/h3img/jobs/ROUND.json` (share of the view that changed), then
   `CV production/imagegen/face_look.py OUT2 "reference=OUT/source-cast-off.png" "panel now=VIEW.png@BOX" "s701=CANDIDATE.png@BOX" ...`
   (`@BOX` = the face box, e.g. `@0.28,0.02,0.72,0.21`; the first face is the reference).
6. **The owner picks blind:** show the sheet of faces without the scores
   (`character_panel.py strip OUT2/_face-candidates.jpg TITLE 0,0,1,1 OUT/source-cast-off.png OUT2/crops/*.png`), record
   the pick, then record whether it was the top score. Add every such comparison to the report's evidence table.
7. **Make the master calm and clean** if it copied an expression, loose hair or marks from the art:
   `character_panel.py NAME edit ROUND SEEDS face calm PICKED.png`. Score the results against the pick.
8. **Carry it to the other views** as for any key item: `turn` the master to each angle, then `transfer` the face of
   the same-angle turned picture onto each accepted view, both configurations.
9. **Score every view against the master** (`face_look.py` with the master's face first), run `check`, look at the
   face sheet. The owner accepts; only then `assemble` replaces panel pictures.

## Reading the table
| Number | Read it as |
|---|---|
| same person (0 to 1) | Ranking among candidates made the same way. Higher = closer to the first face. |
| head turn, head nod | Only compare faces at a similar turn. |
| brow / lid darker than the skin, brow thickness | Make-up. Compare with the reference's value. |
| lips darker than the cheek | Make-up; the clearest signal so far. |
| lips redder than the cheek | Only with the coloured light taken off. |
| proportions (lip height, lower face, brow to lid) | Catch a clearly different face. A few percent is below the noise. |

## What the score does not see (check each time)
- **The rest of the picture changed.** Three of four candidates scored well and had moved the whole figure: run `check`.
- **Copied expression, hair across the face, skin marks, the art's light.** All four candidates copied the glare. Look
  at the sheet; a reference face is calm and clean (owner, 2026-11-12).
- **Published pass marks.** OpenCV's 0.363 is for photographs; our faces are paintings.

## Owner's rules that apply
- The design source is the owner's art, never a generated picture. Show the reference before using it.
- Short instructions; the picture is used as a reference; change only the one thing asked for.
- Masters and panel views are made at the panel's full size (3072x5472 for Crimson Frost), the same as key items.
- Nothing in the primary panel is replaced before the owner has picked and seen the result.

## Output
`OUT/face-look.md` and `.json` (one column per face), the face points drawn on each picture (`*-dwpose.jpg`), and the
crops. State in every report that no agent judgement is in the scores.

## What it runs on
DWPose face points (Apache-2.0), YuNet face finder (MIT), SFace recognition model (opencv_zoo, Apache-2.0), our
`face4k_measure.py` and `conjure3d-face` brow measure. Paths, checksums and the download commands: `report.md` section 5.
Models released for non-commercial use only are not used.

**Cost:** one command and about a minute per batch of faces; a master round is four full-size pictures on vert.
**Benefit:** the owner sees ranked candidates with the differences named, and every later view can be checked against
the master without an agent.

## Reference
`report.md` (copy of the closed report csc-scka): what each number means, the full Crimson Frost run, how far to trust
the scores, traps, and the tests still to run. Related: csc-7nsx (reference panels), csc-7exq (the face work).
