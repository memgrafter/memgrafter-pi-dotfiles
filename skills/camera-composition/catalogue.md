# Camera catalogue: primitives (layer 1) and conventional intent (layer 2)

Reference for the `camera-composition` skill. Full research, bibliographic checks and the 2025-2026 papers: report
ticket csc-pt6z (closed). Every mapping below is a **convention** (what the canon teaches the shot is usually used
for), not a law and not audience evidence. Labels: **[conv]** convention from the cited book (chapter names checked
against publisher tables of contents on 2026-11-06; the wording is ours), **[evid]** measured evidence, **[ours]**
our inference, **[owner]** an owner rule in this repo, **[recall]** standard teaching not re-read this session.

## Source keys
| Key | Book (edition checked 2026-11-06) |
|---|---|
| M | Mascelli, *The Five C's of Cinematography: Motion Picture Filming Techniques* (Cine/Grafic 1965; Silman-James 1998). The five C's: Camera Angles, Continuity, Cutting, Close-ups, Composition |
| K | Katz, *Film Directing: Shot by Shot*, 25th Anniversary Ed. (Michael Wiese 2019; 1st 1991). Ch 6 Composing Shots, 7 Editing, 12 Mobile Staging, 13 Depth of the Frame, 14 Camera Angles, 15 Open and Closed Framings, 16 Point of View, 17 The Pan, 18 The Crane Shot, 19-20 Tracking |
| A | Arijon, *Grammar of the Film Language* (Hastings House 1976; Silman-James 1991). Ch 4 The Triangle Principle (line of interest), "Cutting after the movement", "Twenty basic rules for camera movement", "The panning camera", "The travelling camera", "The camera crane and the zoom lens" |
| GS | Bowen, *Grammar of the Shot*, 5th ed. (Routledge 2023; eds 1-2 by Roy Thompson 1998/2009). Ch 2 Basic Motion Media Shot Composition, 3 Depth, Perspective and Focus, 5 Will It Cut?, 6 Dynamic Shots |
| GE | Bowen, *Grammar of the Edit*, 5th ed. (Routledge 2023, (c) 2024). "PIP" = its numbered Principles in Practice (titles checked in the publisher preview) |
| B | Block, *The Visual Story*, 3rd ed. (Routledge 2020/(c) 2021). Ch 2 Contrast & Affinity, 3 Space, 7 Movement, 8 Rhythm, 9 Story & Visual Structures |
| Br | Brown, *Cinematography: Theory and Practice*, 4th ed. (Routledge 2022). Ch 2 The Frame, 3 Language of the Lens, 4 Continuity, 16 Camera Movement. (5th ed. listed by Routledge, (c) 2027) |
| Me | Mercado, *The Filmmaker's Eye: Learning (and Breaking) the Rules of Cinematic Composition*, 2nd ed. (Routledge 2022) |
| VS | Van Sijll, *Cinematic Storytelling: The 100 Most Powerful Film Conventions* (Michael Wiese 2005). Ch 1 Space, 2 Frame, 9 Camera Lenses, 10 Camera Position, 11 Camera Motion (each convention tied to a film example) |
| Mu | Murch, *In the Blink of an Eye*, 2nd ed. (Silman-James 2001). "The rule of six" |
| BT | Bordwell, Thompson & Smith, *Film Art: An Introduction*, 13th ed. (McGraw Hill 2023). "The Shot: Cinematography"; "The Relation of Shot to Shot: Editing" |
| G | Glebas, *Directing the Story*, 2nd ed. (Routledge/CRC (c) 2026). Ch 7 How to Direct the Eyes, 8 Directing the Eyes Deeper in Space and Time |
| HH | Haigh-Hutchinson, *Real-Time Cameras* (Morgan Kaufmann/CRC 2009). Ch 3 Cinematography, 4 Camera Design, 8 Navigation and Occlusion, 9 Motion and Collision |
| H3 | MiniMax, H3 prompt-writing skill, `references/base-en.txt` §4.2-4.3 (GitHub MiniMax-AI/MiniMax-H3, commit a107547, 2026-08-11): the source of the owner's camera table (csc-k7yv) |
| RED | RED Digital Cinema, "Panning Speed Best Practices" (reddigitalcinema.com/red-101/camera-panning-speed) |

## Layer 1: primitives

### Motion type (H3 vocabulary, owner table csc-k7yv)
| Motion | What physically changes | Reads as (perception) |
|---|---|---|
| zoom in/out | focal length only | magnification, **no parallax**; background flattens or widens with the subject (GE PIP #7; Me "zoom shot") |
| push in / pull out (dolly) | camera moves along the lens axis | **parallax**: near things grow and slide faster than far things; the viewer "travels" (GE PIP #7, #8) |
| pan L/R, tilt U/D | camera rotates in place | scanning or following; no parallax (A "The panning camera"; K ch 17) |
| truck L/R, pedestal U/D | camera translates sideways / vertically | parallax across the frame (K ch 19-20) |
| arc | camera circles the subject | the subject stays, the background turns (VS ch 11 "Circular") |
| tracking | camera follows a moving subject | moves with the subject; the background streams (VS ch 11; K ch 19-20) |
| static | nothing | the action inside the frame carries (VS ch 11 "Static Shot") |
| shake slightly/strongly | small random motion | handheld presence, impact (VS ch 11 "Handheld") |
| POV | camera = a character's eyes | subjectivity (VS ch 10; K ch 16) |
| roll CW/CCW | rotation about the lens axis | disorientation (VS ch 11 "Rotation") |
| also used: crane/jib, aerial/drone, whip pan, dolly zoom, rack focus | see the table in layer 2 | |

### Amplitude and speed
- H3: "with small/large amplitude", "at slow/fast speed"; omit both when medium/normal (H3 §4.3) [conv].
- Upper speed for a non-whip pan or truck: no faster than one full image width in about 7 s at 24 fps with a 180°
  shutter, or judder shows (RED rule of thumb) [conv]. Faster moves either become a whip (deliberate blur) or need a
  higher frame rate. Our H3 takes are 24 fps; Godot renders 30 fps.

### Duration and timing (only sourced numbers)
| Quantity | Value | Source |
|---|---|---|
| Frame 0 carries the hook; first motion onset and sound **by** ~0.3 s | 0.3 s = 7 frames @24, 9 @30 | [owner] AGENTS.md 2026-10-30 |
| A beat that works: "telegraph, then do" | 0.7 s + 0.8 s = 1.5 s (36 frames @24, 45 @30) | [owner] H3_OWNER_GUIDE §1; cut.json `_shots` |
| A new picture about every | 1.5-2 s | [owner] brief for this skill (not measured as a rule; see report) |
| Caption hold | >= 0.6 s + 0.3 s per word | [owner] AGENTS.md |
| H3 shortest take; take lengths | 1.625 s; 17n+5 frames at 24 fps | [evid] h3-takes skill |
| Swipe exits peak | 1.0-1.5 s (Kuaishou log, 2022) | [evid] research/tiktok-virality §1 |
| Pan speed limit | >= ~7 s per image width @24 fps | [conv] RED |

Holds: begin and end each pan, tilt or dolly on a static frame (GE PIP #10) [conv]; move after the motivating action
starts and settle before the cut (A "Cutting after the movement"; motivated movement, Br ch 16) [conv]. The length of
a hold is not given by a source we checked: derive it from the beat (telegraph part = hold, do part = move) and check
it on the render.

Easing: animation's "slow in and slow out" (Thomas & Johnston, *The Illusion of Life*, 1981) [recall]. In our Godot
rails, `ease` follows Godot's `ease()`: 1 linear, 0..1 ease-out (fast start, settles), >1 ease-in, <0 in-out
(`project/shot.gd`). A move that starts on a cut usually wants ease-out (it is already moving); a move inside a shot,
after a hold, wants in-out [ours].

### Lens (focal length) and perspective
- Wide lens: deep space, exaggerated depth and speed along the z-axis, distortion near the lens (VS ch 9 "Wide-Angle",
  *Citizen Kane*; vistas and establishing, *The Piano*) [conv].
- Long (telephoto) lens: compresses depth, flattens, isolates the subject from the background; movement toward the
  camera seems to make little progress (VS ch 9 "Telephoto", *The Graduate*; Br ch 3) [conv].
- Zoom vs dolly: only a camera move changes perspective (GE PIP #7) [conv]; novices confuse the two, trained annotators
  do not (CameraBench, arXiv 2504.15376) [evid].
- mm boundaries ("wide < 35 mm, normal ~50 mm, long > 85 mm" on full frame) are common teaching [recall]; in 9:16 state
  the gate (see `rigs.md`).

### Shot size, angle, height
- Sizes: ECU, BCU/CU, MCU, MS, MLS/MWS, LS/WS, VLS, XLS, plus 2-shot and OTS (GE ch 2; Me "Sizes") [conv].
- Angle/height: eye level, high, low, overhead/bird's-eye, worm's-eye, canted/Dutch (Me "Conventions"; VS ch 10;
  K ch 14; M "Camera Angles") [conv].

## Layer 2: conventional intent

| Choice | Conventional use (what the viewer is meant to feel or understand) | Source |
|---|---|---|
| ECU | intensify one detail; abstraction; strips context | VS ch 10 (*Kill Bill*); Me "Extreme close-up", "Abstract shot" [conv] |
| CU | emotion, intimacy, emphasis; the strongest emotional effect | M "Close-ups"; GE PIP #5 (close-ups for greatest emotional effect) [conv] |
| MS / MCU | conversation, body language with face | GE ch 2; Me [conv] |
| Wide / establishing | orientation: where, who, how big; isolation | GE PIP #4; Me "Establishing shot"; VS ch 9 [conv] |
| Return to wide after close-ups | re-orient the viewer | GE PIP #2 [conv] |
| OTS / 2-shot | relationship; puts the viewer in the exchange | VS ch 10 (*Chinatown*); GE ch 2 [conv] |
| High angle | subject smaller, weaker, observed | M; VS ch 10 (*Citizen Kane*); K ch 14 [conv; meaning depends on context, BT [recall]] |
| Low angle | subject stronger, dominant or threatening | VS ch 10 (*E.T.*); K ch 14 [conv] |
| Canted / roll | unease, disorientation, instability | Me "Canted shot"; VS ch 11 "Rotation"; Google Veo prompt guide ("tilted horizon for unease or dynamism") [conv] |
| POV | identification; threat seen through a watcher | VS ch 10 (*Halloween*, *Jaws*); K ch 16; Me "Subjective shot" [conv] |
| Static | observation, composure, lets action or performance play | VS ch 11 (*Klute*) [conv] |
| Push in | growing attention, realisation, tension toward a subject | VS ch 11 "Push In/Push Out" (*Fargo*); K ch 19-20 [conv] |
| Pull out | reveal context, isolation, ending; needs a motive | GE PIP #8 (beware dolly-outs without motivation); Veo guide ("dolly out ... to emphasize their isolation") [conv] |
| Pan | survey a space, connect two subjects, follow | VS ch 11 (*Dances with Wolves*); K ch 17 [conv] |
| Tilt up on a character | stature, power, awe | VS ch 11 (*The Professional*) [conv] |
| Tracking / Steadicam | accompany, momentum, immersion in movement | VS ch 11 (*Fatal Attraction*, *Goodfellas*); K ch 19-20 [conv] |
| Arc / circular | heighten a moment, encircle, show a subject from all sides | VS ch 11 (*Reservoir Dogs*) [conv] |
| Crane | change of scale, omniscient view, opening/closing a scene | VS ch 11 (*Touch of Evil*); K ch 18 [conv] |
| Aerial | geography, scale, journey | VS ch 11 (*The Piano*); Me "Aerial shot" [conv] |
| Handheld / shake | immediacy, documentary authenticity, chaos, impact | VS ch 11 (*Touch of Evil*, *Pulp Fiction*); Br ch 16 [conv] |
| Whip pan | energy; a transition point between shots | GE ch 6 PIP #3 [conv] |
| Dolly zoom | vertigo; sudden realisation, the world shifting | Me "Dolly zoom shot"; Veo guide ("Vertigo effect") [conv] |
| Rack focus | shift attention along depth without cutting | VS ch 1 "Z-Axis (Rack Focus)" (*The Graduate*) [conv] |
| Depth staging (planes of action) | several layers of story in one frame | VS ch 1 (*Dolores Claiborne*); K ch 13; GS ch 3 [conv] |
| Balance / imbalance | stability vs tension | VS ch 2 (*Disco Pigs*) [conv] |
| Directing the eye (contrast, lines, light, movement) | the viewer looks where you need | VS ch 2; G ch 7-8 [conv] |
| Open vs closed framing | world continues beyond the frame vs a contained, composed world | K ch 15 [conv] |
| Rule of thirds, headroom, lead (look) room, negative space | balanced, readable frames; room in the direction of gaze or travel | GS ch 2; Br ch 2 [conv] |
| Contrast vs affinity between shots | more contrast in a visual component = more visual intensity; affinity = calm, low intensity | B ch 2, ch 9 [conv] |

Combinations (motion x speed x amplitude) [ours, built from the rows above]: slow small push = intimacy, dawning
thought; fast large push = shock, emphasis; slow large pull out = reveal of scale, loneliness, ending; fast whip =
energy, transition; slow arc = admiration, a turning point; strong shake = impact or chaos; static after movement =
a full stop.

## Disciplines and media (what changes)
- **Live-action film/TV:** continuity system, coverage (master + singles + inserts), motivated movement (A, K, BT, GE).
- **Commercials and music videos:** shorter shots, more cutting on rhythm; editors judge AI cinematic ads on narrative
  progression, audio-visual coordination, composition, shot-to-shot continuity, brand coherence and rhythm
  (arXiv 2608.24329, 2026-08) [evid, small expert study].
- **Documentary:** handheld and observation read as authentic (VS ch 11 handheld) [conv].
- **2D animation / anime layout:** the "camera" moves artwork: pans across long backgrounds, multiplane depth, held cels,
  track-in/out (T.U./T.B.) on flat art. LaMarre (*The Anime Machine*, U. Minnesota Press 2009) names the
  "multiplanar image" and contrasts cinematism (movement into depth) with animetism (sliding planes) [conv; the two
  definitions are recall]. Our Godot 2.5D shots are this kind of camera: Parallax2D layers, rails and zoom.
- **3D animation:** a real virtual camera; every lens and path is a choice; nothing is "free" handheld (HH ch 3) [conv].
- **Game cameras:** keep orientation, let the player judge distance, keep line of sight, avoid motion sickness
  (Nesky, "50 Camera Mistakes", GDC 2014); damping, occlusion and collision (HH ch 8-9) [conv].
- **Virtual production:** visualization, performance capture, hybrid and in-camera VFX with a tracked real camera
  (Kadner, *The Virtual Production Field Guide* vol. 1 2019, vol. 2 2021, Epic Games) [conv].
- **Vertical short-form:** one subject, centred tall compositions, text in the safe box, frame 0 as hook, motion onsets
  over continuous drift (see SKILL.md, layer 3).
- **AI video models:** camera is prose in the prompt (H3, Veo, Sora: "one camera move and one subject action per shot",
  Sora 2 guide, 2026-03) or a parameter/LoRA (Luma camera-motion strings and `dolly_zoom` concept, docs 2026-07;
  Lightricks LTX-2 camera LoRAs: static, dolly in/out/left/right, jib up/down, 2026-01). Models confuse
  translation with rotation and left with right (arXiv 2607.03043, 2610.17242) [evid].
