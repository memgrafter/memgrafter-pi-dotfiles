<!-- Copy of the closed report ticket csc-scka in characteragent.ai-social-content (.tickets/csc-scka.md), taken 2026-11-12.
     The ticket is the source: later results are added there first, then copied here. -->

# Report: picking and checking a character's reference face by measurement (face recognition score, make-up colours, face points), with Crimson Frost as the worked example

This report explains how to choose a character's reference face, and how to check that every later picture still shows
that face, using numbers that a program computes instead of an agent's opinion. It was written on 2026-11-12, right
after the method was tried for the first time on Crimson Frost and the owner's own pick matched the top score.

It belongs with the report on reference panels (csc-7nsx). That report explains how a panel is built and how a key item
such as the pauldron is made right from every direction. This one covers the face, which is a region of the panel like
any other, but one where "does it look like her" could not be measured before.

The work itself is tracked in csc-7exq. Read `.tickets/csc-scka.md` directly; `tk show` does not display the sections.

## 1. What the owner asked for

After the face sheets were shown under the key art's light and the differences were still there, the owner asked
(2026-11-12, in chat):

> "can you build a reference face better using facial recognition and other facial analysis techniques?"

and, once the first candidates were being made:

> "ok and you are doing 16MP face technique right? just like before?"

After looking at the four candidates:

> "1. yeah human eye says 701, so 701 if that scored the highest. surprised the metrics"
>
> "Ok, since my blind decision on 701 with good conviction matched the scoring method, please document it clearly in a
> closed report ticket, completely, reusably."

And on the two questions that were still open:

> "2. yeah i see they are copied, reference face should be calm and clean for example the other, which we cant use
> since it will pull the reference away."
>
> "3. right... let's try the brown"

So the owner's decisions are: candidate 701 is the face; the reference face must be calm and clean (no glare, no hair
across the face, no mark on the cheek); the hair stays the panel's brown for now.

## 2. The short version

1. A program measures each face: one score for "is this the same person as the reference", a few numbers for make-up
   (how dark the brows, the lids and the lips are), and a few proportions.
2. The reference is the owner's own art: the face cut from the key art, with the coloured light taken off.
3. Candidate faces are made at the panel's full size, in the panel view whose head turn matches the key art.
4. Every candidate is measured. The owner picks by eye from a sheet, without the scores. Then the pick is compared
   with the scores.
5. On Crimson Frost the owner picked candidate 701, and 701 had the highest same-person score of the four (0.677,
   against 0.487 for the panel's face before). That is one agreement out of one try. With four candidates, a match by
   luck alone happens one time in four, so this is encouraging and not yet proof.
6. The score does not see everything. It did not see that three of the four candidates had moved the whole figure in
   the frame, or that all four had copied the key art's glare, loose hair and cheek mark. Those are checked separately
   (section 9).
7. No agent's judgement is used anywhere in the scoring.

## 3. Words used in this report

- **Reference face**: the face every other picture is compared with. Here: the key-art face.
- **Key art**: the owner's painting of the character, "Sunset Huntress" for Crimson Frost.
- **Cast**: the colour that the painting's light puts on everything (the key art is lit orange by a sunset).
  "Cast off" means that colour has been removed, so skin looks like skin in plain light.
- **Candidate**: one generated picture that might become the face.
- **Master**: the candidate the owner picks. All other views get their face from it.
- **Same-person score**: one number from a face recognition model, from about 0 to 1. Higher means the two faces are
  more alike to the model.
- **Face points**: 68 points a program places on a face (brows, eyes, nose, lips, jaw line).
- **Head turn**: how far the head is turned left or right, in degrees.
- **Eye span**: the distance between the outer corners of the two eyes. Other sizes are given as a share of it, so the
  numbers do not depend on how large the face is in the picture.

## 4. What is measured, and what each number is good for

All of this is one tool, `production/imagegen/face_look.py`. It writes a table with one column per face.

| Number | What it is, in plain words | How to read it | What it cannot tell you |
|---|---|---|---|
| Same person | A face recognition model turns each face into a list of numbers; this is how closely the list of this face matches the list of the first face. | Use it to RANK candidates made the same way. Higher is closer. | It is not a pass mark. Light, head turn and expression also move it (section 8). The model learned from photographs, not paintings. |
| Head turn, head nod | Which way the head points, from the 68 face points. | Compare faces only at a similar head turn. Pick the panel view whose turn matches the reference. | Unreliable for full profiles, where half the points are hidden. |
| Brow darker than the skin | How much darker the brow is than the skin just above it. | Bigger = darker brow. Compare with the reference's value. | Hair lying over the brow raises it. |
| Brow thickness | How thick the dark band of the brow is, as a share of the eye span. | Compare with the reference. | Same. |
| Brow arch | How high the brow's arch rises, as a share of the brow's length. | Compare with the reference. | A raised or lowered brow (expression) changes it. |
| Lid darker than the skin | How much darker the strip between brow and upper lid is than the skin. | More negative = darker lid (smoky make-up). | Shadow from the light counts too. |
| Lips darker than the cheek | How much darker the lips are than the cheek under the eye. | Bigger = darker lips. This was the clearest difference on Crimson Frost. | Needs a closed or nearly closed mouth. |
| Lips redder than the cheek | How much redder the lips are than the cheek. | Only meaningful with the cast off. In the key art as painted it came out negative (-10.7), because the orange light reddens the cheek as much as the lips. | Anything under coloured light. |
| Lip height / nose length, upper lip / lower lip, brow above the lid / nose length, nose base to chin / nose length | Proportions measured up and down the face. They keep their value when the head turns sideways. | Differences of a few percent are below what the points can resolve (section 8). Use them to catch a face that is clearly a different shape. | They change when the head nods or the expression changes. |
| Eye span in pixels | How large the face was when measured. | A face under about 100 pixels is too small to measure well. | |

Two things the tool does not measure, which must be checked another way:
- **Whether the rest of the picture stayed the same.** `character_panel.py NAME check JOB.json` gives the share of the
  accepted view that changed. A face swap should change a small share.
- **Expression, loose hair, marks on the skin.** These are looked at on the sheet.

## 5. What it runs on

Everything runs on the Mac, on the processor, with no graphics card.

| Part | What it does | File | Licence |
|---|---|---|---|
| DWPose `dw-ll_ucoco_384.onnx` (yzd-v/DWPose, revision 1a71441) | Finds the 68 face points | `/Volumes/ExternalData/models/dwpose-1a71441/` (SHA-256 724f4ff2...1843) | Apache-2.0 |
| YuNet `face_detection_yunet_2023mar.onnx` (opencv_zoo) | Finds the face and lines it up for the recognition model | `/Volumes/ExternalData/models/yunet-2023mar/` (SHA-256 8f2383e4...2fa4) | MIT |
| SFace `face_recognition_sface_2021dec.onnx` (opencv_zoo at commit eb9f4f2d) | The recognition model: gives the same-person score | `/Volumes/ExternalData/models/sface-2021dec/` (SHA-256 0ba9fbfa...4e79; 38.7 MB; LICENSE beside it) | The opencv_zoo page says "All files in this directory are licensed under Apache 2.0 License". It does not say which pictures the model was trained on. |
| `production/imagegen/face4k_measure.py` | Our code from the 3D face work (csc-sfc4): runs DWPose, works out head turn and nod | in this repository | ours |
| `huntress_brows.py` in `/Volumes/ExternalData/code/conjure3d-face` (branch `face`, commit 7250eec) | Our code from the 3D face work: brow darkness, brow thickness, lid darkness | read from that folder; if the folder is missing the three brow and lid rows are left out and everything else still runs | ours |
| Python | `/Volumes/ExternalData/code/conjure3d-character-venv/bin/python` (Python 3.13.13, OpenCV 5.0.0, onnxruntime 1.31.1, numpy 2.5.4) | | |

Why SFace and not the better-known face models: several of those are released for non-commercial use only, and
non-commercial terms block us (AGENTS.md). SFace is the one whose files carry a licence we can use. We use it only to
measure our own pictures; the model is not shipped and nothing is trained from it.

OpenCV's own documentation gives 0.363 as the score at or above which SFace calls two PHOTOGRAPHS the same person
(measured by them on the LFW photo set). Do not use that as a pass mark here: our faces are paintings.

To set this up on another machine: download the three model files above to the same paths (or change the three paths
at the top of `face_look.py`), and use any Python that has OpenCV, onnxruntime and numpy. The download commands used
for SFace on 2026-11-12:

```
mkdir -p /Volumes/ExternalData/models/sface-2021dec && cd /Volumes/ExternalData/models/sface-2021dec
curl -sSL -o face_recognition_sface_2021dec.onnx https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx
curl -sSL -o LICENSE https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/LICENSE
shasum -a 256 face_recognition_sface_2021dec.onnx     # must print 0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79
```

## 6. The procedure, step by step, for any character

`PY` is `/Volumes/ExternalData/audio8/venv/bin/python -I` (the panel tool) and `CV` is
`/Volumes/ExternalData/code/conjure3d-character-venv/bin/python -I` (the measuring tool). Run from the repository root.

**Step 1. Describe the face in the character's file** (`production/imagegen/characters/NAME.json`, region `face`):
- `box`: where the face is in a panel view, as shares of the picture.
- `source`: the owner's art (`path`), the face's box in it (`box`), and `cast_patch`: a patch of that art that should
  be grey or black (leather, steel). The tool uses it to work out the colour of the light and take it off.
- `flat_on`: the panel view whose head turn matches the reference face. Measure it, do not guess (step 2).
- `pair`: `one-sided`. A face is never flipped.
- `wording`: the instruction given to the picture model. The owner's rule is short instructions, the picture used as a
  reference, and only the one thing asked for.

**Step 2. Measure the reference and the panel as it is.**

```
CV production/imagegen/face_look.py OUTDIR --character NAME CONFIG
```

This writes the reference face twice (as painted, and with the cast off), the face of every panel view that looks
toward the camera, and the table `OUTDIR/face-look.md`. Read two things from it: which panel view has the same head
turn as the reference (that is `flat_on`), and where the panel differs from the reference (lips, brows, lids).

To see the same thing by eye, put the reference's light on the panel faces:
`PY production/imagegen/character_panel.py NAME sheet face --source-light`. If a difference is still there under the
same light, it is a difference in the design and not in the light.

**Step 3. Show the owner the reference** (the cast-off face cut, `OUTDIR/source-cast-off.png`) before anything is
made from it. This is the owner's rule for every reference.

**Step 4. Make master candidates at the panel's full size.**

```
PY production/imagegen/character_panel.py NAME swap ROUND SEEDS face ref=OUTDIR/source-cast-off.png:right:0,0,W,H CONFIG:AZ:right > production/h3img/jobs/ROUND.json
```

`AZ` is the `flat_on` view. `right` or `left` is the edge of the picture the face looks toward, in the reference and in
the view; they must be the same, because a face is not flipped. Copy the two input pictures the command wrote (in the
character's `work` folder) to `work_vert` on vert, copy the job file to vert, and run it with
`bash tools/run_cards.sh ROUND ...` (production/h3img). Four seeds is a reasonable first round.

**Step 5. Measure the candidates.**

```
PY production/imagegen/character_panel.py NAME check production/h3img/jobs/ROUND.json      # how much of the view changed
CV production/imagegen/face_look.py OUTDIR2 "reference=OUTDIR/source-cast-off.png" "panel now=PANEL_VIEW.png@0.28,0.02,0.72,0.21" "s701=CANDIDATE_701.png@0.28,0.02,0.72,0.21" ...
PY production/imagegen/character_panel.py strip OUTDIR2/_face-candidates.jpg "TITLE" 0,0,1,1 OUTDIR/source-cast-off.png OUTDIR2/crops/panel-now.png OUTDIR2/crops/s701.png ...
```

The first face named is the reference. Use the cast-off reference when the candidates are in plain light, so that the
light does not count against them. `@0.28,0.02,0.72,0.21` is the face box of the character's file (shares of the
picture's width and height): the tool cuts that box out of the full view, saves it in `OUTDIR2/crops/` and measures it.

**Step 6. The owner picks, blind.** Show the sheet of faces WITHOUT the scores. Record the pick. Then put the pick
beside the scores and record whether they agree. Every such comparison is evidence for or against the method, so keep
them all (section 8 holds the list).

**Step 7. Make the master what a reference needs to be.** A reference face is calm and clean (owner, 2026-11-12). If
the pick carries an expression, loose hair or marks from the art, change only that:

```
PY production/imagegen/character_panel.py NAME edit ROUND SEEDS face calm PICKED.png > JOB.json
```

Measure the results against the pick (same-person score against the picked face) and against the reference.

**Step 8. Carry the face to the other views**, exactly as for a key item (csc-7nsx section 5): turn the master to each
angle (`turn`), then put the face of the same-angle turned picture onto each accepted view (`transfer`), both
configurations. Nothing has to be rotated by the model in the final step.

**Step 9. Check every view against the master.** Run `face_look.py` with the master's face first and each view's face
after it. Within one character, in one style and one light, this is where the same-person score is most at home.
Also run `check` on each job, and look at the face sheet.

**Step 10. The owner accepts the views.** Only then are the panel's pictures replaced (`assemble`).

## 7. The worked example: Crimson Frost, 2026-11-12

**The reference.** The face cut from the key art (box 2760,144 to 3408,792, 648 pixels square), cast taken off using
the patch 2860,1010 to 3060,1250. The eye span in it measures 230 pixels. Head turn: 28 degrees to the picture's right.

**The panel before, against the key art as painted** (`face-look/face-look.md`):

| Face | Same person | Head turn | Lips darker than cheek | Brow darker than skin | Lid darker than skin |
|---|---|---|---|---|---|
| Key art, as painted | 1.000 | -27.6 | 36.5 | 65.8 | -66.9 |
| Key art, cast off | 0.822 | -28.6 | 39.4 | 64.8 | -65.3 |
| Panel, front | 0.375 | -3.6 | 17.5 | 52.1 | -63.6 |
| Panel, front-left | 0.429 | +34.2 | 17.4 | 62.0 | -64.2 |
| Panel, front-right (the matching turn) | 0.451 | -28.0 | 24.5 | 47.4 | -58.9 |
| Earlier 3D-work face set, front | 0.466 | -4.2 | 29.9 | 73.1 | -78.0 |
| Earlier 3D-work face set, same turn | 0.617 | -36.1 | 34.3 | 78.2 | -54.8 |
| Hook picture 1 of the landslide short | 0.489 | +28.7 | 29.2 | 62.0 | -73.9 |
| Hook picture 3 of the landslide short | 0.323 | +9.7 | 16.1 | 43.3 | -47.6 |

What this said: the panel's lips are far paler than the key art's (17 to 25 against 36 to 39) and its brows lighter in
two of three views. Its lids are about right. The front-right view has the same head turn as the key art, so the
master is made there. Hook picture 3, which the main session had called "older and less like her" by eye before any
measuring, has the lowest score in the table.

**The four candidates** (round `h3img-cf-face1`, the accepted cloak-off front-right view with "replace only her face,
entirely, with the face in the close up", 3072x5472, MiniMax H3 Image; measured against the key art with the cast off;
`face-look-face1/face-look.md`):

| Face | Same person | Lips darker than cheek | Brow darker than skin | Lid darker than skin | Share of the view that changed |
|---|---|---|---|---|---|
| Key art, cast off | 1.000 | 39.4 | 64.8 | -65.3 | |
| Panel before | 0.487 | 24.5 | 47.4 | -58.9 | |
| 701 | 0.677 | 39.6 | 64.1 | -54.0 | 14.4 % |
| 702 | 0.642 | 35.4 | 68.8 | -69.0 | 15.0 % |
| 703 | 0.631 | 38.9 | 55.1 | -56.1 | 15.4 % |
| 704 | 0.656 | 46.4 | 62.5 | -60.8 | 4.3 % |

Measured time per picture: 303.9 and 304.5 s for the first on each card, 278.5 and 279.9 s for the second (vert cards 1
and 2; power limits read with nvidia-smi the same evening: 250 W and 275 W; two video drafts were running on the other
two cards).

**The pick.** The owner picked 701 by eye ("human eye says 701"), and calls the pick blind and made with good
conviction. 701 has the highest same-person score, and its lips and brows are the closest to the key art's of the four
(lips 39.6 against 39.4, brows 64.1 against 64.8). The main session had recommended 704, because 704 was the only one
that left the rest of the view alone; the owner's eye and the score both preferred 701.

**What the score did not show.** In 701, 702 and 703 the whole figure moved in the frame (14 to 15 % of the view
changed), so none of them can replace the panel view as it is; 701's face is carried onto the accepted view in the
next step. All four copied the key art's narrowed glare, its loose strands of hair across the face and the small red
mark on the cheek. 702 also took the sunset light and darker hair, although the instruction said to keep the studio
light. The owner's decision: the reference face is calm and clean; the hair stays brown.

**What happens next** (csc-7exq): 701 made calm and clean (`edit ... face calm`, and for comparison the swap from the
key art with a calm instruction), then turned and carried to the other views. Results are added to this report.

## 8. How far to trust the numbers

What we know so far, all from 2026-11-12:

| Evidence | What it shows |
|---|---|
| The owner's blind pick among four candidates was the one with the top same-person score. | One agreement in one try. Chance alone gives one in four. |
| The picture the main session had called "less like her" by eye had the lowest score of nine faces. | A second agreement, but with the main session's eye, not the owner's. |
| The key art against its own copy with only the colour of the light changed scores 0.822, not 1. | Light alone can cost about 0.18. Compare faces in the same kind of light. |
| The panel's front view scores lower (0.375) than its front-right view (0.451), which has the reference's head turn. | Head turn moves the score. Compare at a similar turn. |
| The lip and brow numbers agreed with what the eye saw under matched light, before and after. | The make-up numbers are well above their noise. |
| From the 3D face work (csc-sfc4): one face point is uncertain by about 2 % of the eye span. | Shape differences of a few percent cannot be resolved from one picture. |

So, today: use the same-person score to rank candidates that were made the same way, in the same light, at the same
head turn. Use the make-up numbers to say what is different and by how much. Do not accept or reject a picture on a
number alone.

## 9. Traps found

- **A higher score with a changed picture.** Three candidates scored well and had moved the whole figure. Always run
  `check` beside the score.
- **The model copies everything in the reference cut**, not only the features: expression, hair lying across the
  face, a mark on the skin, and sometimes the light. Say in the instruction what a reference face must be (calm,
  clean, the view's own light), and expect to need an edit step.
- **Coloured light makes colour numbers meaningless.** Take the cast off the art, or put the art's light on the
  pictures, before comparing colour.
- **The recognition model was trained on photographs.** Its published pass mark (0.363) does not carry over to
  paintings.
- **Profiles and back views get no score**, because no face is found. They can only be checked by eye and by the
  proportions that survive (nose, lips, chin in profile).
- **One piece of art, one angle.** The key art shows one head turn. Every other angle is checked against the master,
  never against the art.

## 10. Not tested yet, and how to test it

| Question | Test | What would make it normal practice |
|---|---|---|
| Does the owner's blind pick keep matching the top score? | Record every blind pick beside the scores (step 6), for faces of this and other characters. | A clear majority over at least ten picks. Until then the score ranks and the owner decides. |
| Does the score hold a face across the panel's views? | After step 8, score every view against the master; then have the owner mark any view whose face looks off. | The views the owner marks are the lowest-scoring ones. |
| Does the score catch a face drifting in video? | Run `face_look.py` on frames of a video take against the master (it takes any picture). | Frames a person calls "not her" score clearly lower than the rest. |
| Which reference should candidates be scored against, the art as painted or with the cast off? | Score the same candidates both ways and see which order matches the owner's picks. | One of the two matches more often. |
| Does it work for non-human characters? | Not expected to: the recognition model and the face points are for human faces. Try it on one creature and see what comes back. | A creature needs its own measures (the report on panels treats creatures as their own category). |
| Can expression be measured? | Add eye opening and mouth corner height from the face points to the table and compare a calm and a glaring face. | The calm one is told apart reliably. |

## 11. Where an agent's judgement was used

Nowhere in the scoring: every number is computed. The judgements were the owner's pick, and the main session's look at
the sheets (what was copied from the art, which candidate kept the view). The main session's recommendation (704)
was not the owner's pick (701).

## 12. Files

- Tools: `production/imagegen/face_look.py` (measuring); `production/imagegen/character_panel.py` (`sheet
  --source-light`, `swap`, `edit`, `turn`, `transfer`, `check`, `strip`); `production/imagegen/face4k_measure.py`.
- Character settings: `production/imagegen/characters/crimson-frost.json`, region `face`.
- Measurements: `/Volumes/ExternalData/social-content/broll/images/h3img-refs/crimson-frost-reference/face-look/`
  (reference and panel) and `face-look-face1/` (the four candidates; `_face-candidates.jpg`,
  `_face-candidates-upper.jpg`).
- Candidates: `/Volumes/ExternalData/social-content/broll/images/h3img-cf-face1/`; job
  `production/h3img/jobs/h3img-cf-face1.json`.
- Face sheets under the key art's light: `/Volumes/ExternalData/social-content/art/crimson-frost-reference/_face-cloak-on-source-light.jpg`
  and `_face-cloak-off-source-light.jpg`.
- Earlier work this builds on: csc-sfc4 (the 3D head against the key art), csc-7nsx (reference panels).

## 13. Still open

- The calm and clean master, and carrying it to every view (csc-7exq).
- The hair: brown for now (owner: "let's try the brown"); the key art's hair is near black.
- The tests in section 10.
