---
name: video-filmstrip
description: |
  Capture a live web/3D scene as a real high-fps video with Playwright's record_video,
  analyze its temporal properties (is it really animating? what's the period?), and build a
  "filmstrip" / sandwich-board of evenly-spaced labeled frames into one image for side-by-side
  comparison. Use when you need a real clock on motion (wave/oscillation period, liveness,
  duplicate-frame detection) or a persistent visual reference of an animated scene.
---

# Video Capture + Filmstrip ("Sandwich Board")

Record a **live** page (a WebGL/3D scene, an animated app, a game) as a **real video** with a
true time base, then turn it into a **filmstrip** — a single tiled image of evenly-spaced,
labeled frames — so you can *see* the motion and compare it against a target.

Two distinct jobs, one pipeline:

- **The video** gives you a **clock**: real fps, so you can measure *temporal* facts — is it
  actually animating (vs. duplicate frames), and what is the dominant **period** (wave, blink,
  oscillation). A screenshot loop can't do this (it's rate-limited to ~0.2 fps → Nyquist ~10 s).
- **The filmstrip** gives you a **picture**: a 4×4 (or N×M) grid of frames you can look at at a
  glance, each labeled with its timestamp, so you can refer back to the motion continuously. A
  **zoom ladder** (§3b) drills from the overall arc down into a specific stretch, as finely as the
  film needs. And a menu of **image-analysis techniques** (§4) brings out features a raw frame
  hides — mottling, seams, faint color shifts, motion.

Prefer a **headed** (on-screen, GPU) browser for the *real* environment — headless can be
frame-starved (throttled rAF / software render) and will under-report motion.

---

## 1. The capture — Playwright `record_video`

`record_video` samples the browser's **compositor** continuously at a real, uniform rate (25 fps
here). That decouples *how often you look* from *how expensive a frame is* — the whole point.

```python
# capture_video.py  <tag> <url> <settle_s> <record_s> [W H]
import asyncio, glob, os, subprocess, sys
from playwright.async_api import async_playwright

tag, url, settle_s, record_s = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
W, H = (int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (1280, 900)
OUT = f'captures/clipvideo_{tag}'
os.makedirs(OUT, exist_ok=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=False)          # headed -> real GPU, on-screen
        ctx = await b.new_context(
            viewport={'width': W, 'height': H},
            record_video_dir=OUT,
            record_video_size={'width': W, 'height': H})    # match viewport for clean 1:1
        page = await ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(url, wait_until='domcontentloaded', timeout=30000)
        await page.wait_for_timeout(settle_s * 1000)        # get PAST the startup/black race
        await page.wait_for_timeout(record_s * 1000)         # then record N s of real motion
        await page.close(); await ctx.close(); await b.close()
        return errs

errs = asyncio.run(main())
vid = sorted(glob.glob(OUT + '/*.webm'), key=os.path.getmtime)[-1]
print('pageerrors:', errs[:3])
print(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=avg_frame_rate,nb_frames',
      '-of', 'default=noprint_wrappers=1', vid], capture_output=True, text=True).stdout)
```

**The #1 gotcha — the startup race.** Many scenes take ~20–30 s to emit their first real frame
(shader/asset warm-up). `record_video` records the page's **entire lifetime**, so a too-short
settle yields a video that is **mostly black** with the real scene only at the end. **Diagnose**
with the frame-diff signal below: if the *median* per-frame change is ≈ 0 and the active
fraction is low, you recorded the black phase. **Fix:** lengthen `settle_s` (≥ ~30 s for a heavy
3D scene) until the scene is stably rendered, then record.

---

## 2. The analysis — is it really animating, and what's the period?

Extract **low-res** frames and **stream** them one at a time (constant memory — loading hundreds of
full-res frames into a persistent REPL OOMs it). Two diagnostics answer the two real questions:

```python
# analyze_video.py  <video.webm> [out.json] [y0:y1:x0:x1]
import glob, json, os, subprocess, sys
import numpy as np
from PIL import Image

vid = sys.argv[1]
region = sys.argv[3] if len(sys.argv) > 3 else '137:163:50:176'   # a region of interest
y0, y1, x0, x1 = [int(v) for v in region.split(':')]

FDIR = os.path.join(os.path.dirname(os.path.abspath(vid)), '_frames_' + os.path.basename(vid))
os.makedirs(FDIR, exist_ok=True)
# low-res extraction: 320x225 -> ~216 KB/frame, can't OOM
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', vid,
                '-vf', 'scale=320:225', '-vsync', '0', f'{FDIR}/f_%03d.png'], check=True)
fs = sorted(glob.glob(FDIR + '/f_*.png'))

pr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=avg_frame_rate', '-of', 'csv=p=0', vid],
      capture_output=True, text=True).stdout.strip()
fps = (float(pr.split('/')[0]) / float(pr.split('/')[1])) if '/' in pr else 25.0

d, prev, sig = [], None, []
for f in fs:                                          # stream one frame at a time (O(1) memory)
    a = np.asarray(Image.open(f).convert('RGB')).astype(float)
    if prev is not None:
        d.append(float(np.abs(a - prev).mean()))     # frame-diff (motion energy)
    prev = a
    r = a[y0:y1, x0:x1]
    sig.append(float((0.299*r[...,0] + 0.587*r[...,1] + 0.114*r[...,2]).mean()))  # region luminance
d = np.array(d); sig = np.array(sig)

def first_peak(s, lo, hi, thr):
    s = s - s.mean(); n = len(s); hi = min(hi, n - 1)
    ac = np.correlate(s, s, 'full')[n-1:n-1+hi+1]; ac = ac/ac[0]
    for i in range(lo, hi):
        if ac[i] > thr and ac[i] >= ac[i-1] and ac[i] >= ac[i+1]:
            return i, round(float(ac[i]), 3)
    return None

app_pk  = first_peak(d, 1, 40, 0.1)              # duplicate/update structure?
wave_pk = first_peak(sig, 2, len(sig)-1, 0.05)  # dominant brightness/wave period
print(json.dumps({
    'n_frames': len(fs), 'fps': fps, 'duration_s': round(len(fs)/fps, 2),
    'active_frac_dF>2': round(float((d > 2).mean()), 3),
    'diff_mean/median': [round(float(d.mean()), 3), round(float(np.median(d)), 3)],
    'app_update_peak(lag,amp)': app_pk,
    'wave_period_s': round(wave_pk[0]/fps, 3) if wave_pk else None,
}, indent=2))
```

**How to read it:**

- **`active_frac_dF>2`** near **1.0** → genuinely animating at the stamp rate. Near **0** (with
  `diff_median ≈ 0`) → mostly **static/black** (you caught the wrong phase → lengthen the settle).
- **`app_update_peak` at lag `k`** → the app emits a *new* frame every `k` recorded frames → real
  rate = `fps / k`. `null` → no duplicate structure (smooth, continuous motion).
- **`wave_period_s`** → the dominant period of the region's brightness. Brightness tracks wave
  phase (crests reflect more sky/sun), so this is a solid **proxy for the wave period** — on a
  *real* clock.

**Memory/timeout rule:** run the heavy analysis as a **background subprocess** that writes a JSON
you poll — never a long in-REPL cell (the socket times out ~30 s and full-res frames OOM):

```bash
nohup python3 analyze_video.py <vid>.webm /tmp/analysis.json "120:170:60:200" >/tmp/ana.log 2>&1 &
for i in $(seq 1 40); do [ -f /tmp/analysis.json ] && break; sleep 2; done
cat /tmp/analysis.json
```

**Lossy-codec caveat:** `record_video` is VP8/VP9 WebM (lossy). That's **fine for temporal**
analysis (period, motion). But **do not** re-derive fine spatial texture / a power spectrum from
the lossy video — compression ringing lands right in the fine-chop band. Keep **lossless
screenshots** for the spatial work; use the **video only for the clock**.

---

## 3. The filmstrip / sandwich board

Turn the video into **one tiled image** of evenly-spaced, labeled frames — the thing you actually
refer back to. Do it in three steps so the frame count and grid are explicit.

**Step A — extract a downsampled frame sequence** (every Nth frame, small size). Extract *every
5th* frame (5 fps) at 480×338 — small enough to tile, dense enough to read the motion:

```bash
V=<video>.webm
mkdir -p captures/ref_filmstrip
# skip the settle tail if you want only the stable part: prepend select='gte(n\,750)'
ffmpeg -y -v error -i "$V" -vf "select='not(mod(n,5))',scale=480:338" -vsync 0 \
       captures/ref_filmstrip/s_%03d.png
```

> **Gotcha:** invoking `ffmpeg` *once per frame* with a `select=eq(n\,K)` filter and a
> *relative* output path is flaky (it can fail to open the muxer). Do the **single** ffmpeg pass
> above (one invocation, `not(mod(n,5))`) to dump the whole downsampled sequence, then pick
> frames in Python.

**Step B — pick evenly-spaced frames and tile them into an X×Y grid.** The grid dimensions are
part of the artifact — **state them** (e.g. "a 4×4 filmstrip of 16 frames"). Label each cell with
its index, its **real timestamp** (frame-index ÷ extraction-fps), and the original 25 fps frame
number so the clock is unambiguous:

```python
from PIL import Image, ImageDraw
import glob
d = 'captures/ref_filmstrip'
fs = sorted(glob.glob(d + '/s_*.png'))
N = 16                       # how many frames you decide to include
idx = sorted({int(i * (len(fs) - 1) / (N - 1)) for i in range(N)})
sel = [fs[i] for i in idx]

COLS, ROWS = 4, 4            # <-- the X by Y of the sandwich board; N == COLS*ROWS
cw, ch = 480, 338
sheet = Image.new('RGB', (cw * COLS, ch * ROWS), 'white')
dr = ImageDraw.Draw(sheet)
for k, p in enumerate(sel):
    im = Image.open(p).convert('RGB')
    r, c = divmod(k, COLS)
    sheet.paste(im, (c * cw, r * ch))
    t = idx[k] / 5.0                      # extraction was every 5th of 25 fps -> /5 s
    dr.rectangle([c * cw, r * ch, c * cw + cw, r * ch + 26], fill=(0, 0, 0))
    dr.text((c * cw + 6, r * ch + 6), f'#{k:02d}  t={t:.1f}s  (25fps f{idx[k]*5})', fill='yellow')
sheet.save('REF_FILMSTRIP.png')           # e.g. 1920x1352 for a 4x4 of 480x338 cells
print('filmstrip', sheet.size)
```

**Step C — read it back** (`read` the PNG) and describe the motion you see, frame by frame. This
is the "sandwich board": a persistent, glanceable record of the reference's motion that you can
keep open and compare against as you iterate.

---

## 3b. The tighter sandwich board — a zoom ladder (drill-down)

A single even-spacing filmstrip only shows the **overall arc**. When the film is long and you
need to *see the detail in a specific stretch*, build a **zoom ladder**: stack several views, each a
**horizontal strip of `n` frames sampled forward from a start index**:

```
frames = [start, start+step, start+2*step, ...]      # n cells, a directional array forwards
```

Read top-to-bottom the levels go coarse → fine. It is **like a binary search, but instead of
jumping to the midpoint and halving, each level is a linear forward sweep anchored at the start
index of the region you want to focus on.** You pick each window by hand as you look at the level
above it:

- **L0 overall** — wide step, spans the whole film (see the arc, find where it's interesting).
- **L1 drill-down** — a window of L0, tighter step.
- **L2 drill-down on the drill-down** — a sub-window of L1, tighter still.
- …as many levels as the length of the film needs.

The companion script `filmstrip_zoom.py` (this directory) renders the ladder from an already-
extracted frame sequence. Each view is `[start, end, n]` (region; step auto = `(end-start)/n`)
or `[start, step, n, "step"]` (explicit step). It labels every cell with its frame index and every
row with its range + time span, and scales cells down so a wide row never blows out the image:

```bash
# 3-level ladder on a 216-frame 5fps film: whole arc -> stable tail -> tighter tail
filmstrip_zoom.py captures/ref_filmstrip REF_ZOOM.png \
    '[[0,216,8],[150,216,8],[180,216,8]]' --fps 5
# -> 3840x1104, 3 levels. Read it back with `read` and describe the motion per level.
```

**Workflow:** L0 first to *locate* the interesting stretch (a wave cycle, a transition, a glitch),
then re-aim L1/L2 at that stretch until the step is fine enough to read the feature. Because each
level is just a `(start, step, n)` triple, adding a level is one more array element — no new code.

---

## 4. Image-analysis techniques (to *bring out* what a frame is doing)

A raw frame often hides the very thing you're trying to diagnose — a faint mottling, a soft edge,
a near-invisible color shift, a region that's *almost* static. The fix is to **re-render the pixels
so the feature of interest is exaggerated**, then look. These are the techniques used across
sessions; pick the one that matches the question, compose them if needed. (The genuinely
repeatable ones get their own dedicated skills later — this is the menu.)

**Edge / structure**
- **Gradient / Sobel edge map** — magnitude of the spatial gradient; outlines blobs, mottling,
  tile seams, and the waterline. Threshold it for a binary outline.
- **Laplacian / second derivative** — sharper than gradient; highlights thin high-frequency texture
  (fine chop) and ring artifacts.
- **Canny** — hysteresis edge detection for clean, connected contours.
- **Frequency / FFT (2-D power spectrum)** — separate the image into spatial frequencies; a ridge at
  one radius = a dominant wavelength (wave length, tile size). The tool for "is there a *periodic*
  pattern and how big?" (do this on **lossless** frames, not the WebM).

**Contrast / tonal**
- **Local (adaptive) histogram equalization / CLAHE** — blows out locally-repeated midtones so a
  faint mottled patch becomes obvious.
- **Gamma / levels stretch** — push a narrow band of values to full range to reveal a subtle
  gradient (e.g. a fog band that's only 3% of the tonal range).
- **Difference-from-mean / high-pass** — subtract a blurred copy; what's left is the fine detail
  with the smooth background removed (great for isolating ripple texture from the base color).

**Color / channel**
- **Per-channel split (R / G / B) and ratios (R/B, G/B, saturation)** — a color that's "off" in one
  channel shows up as a bright/dark band in a single channel or a ratio map even when the RGB
  composite looks fine.
- **False-color / colormaps (grayscale, heat, HSV-hue)** — map one quantity to a vivid ramp so
  small differences are legible; hue is ideal for wrapping a cyclic quantity (phase, angle).
- **Channel subtraction / difference of two frames or two renders** — isolates exactly what
  changed (or what differs between the target and the candidate).

**Motion / temporal**
- **Frame-diff (|f_t − f_{t−1}|)** — the motion-energy map; static regions go dark, moving ones
  light. The basis of the `active_frac` liveness test above.
- **Optical flow (Farneback / Lucas–Kanade)** — a vector field of *where* pixels move; reveals flow
  direction and speed (waves translating, a UI sliding) that a scalar diff can't.
- **Temporal autocorrelation of a region** — the dominant *period* (see §2); the "clock."
- **Stroboscopic / phase-locked subtraction** — subtract frames a fixed phase apart to cancel the
  periodic motion and leave the non-periodic residue (or vice-versa, to isolate the periodic part).

**Isolation / removal ("remove things to see what's left")**
- **Masking / ROI crop** — zero everything outside the region of interest so the eye isn't pulled
  by the rest of the frame.
- **Term bisection (the user's preferred method)** — for a *rendered* scene, rip a shader term or
  a scene element out until the artifact disappears, then add terms back one at a time to find the
  culprit. The image-analysis steps above are how you *see* each bisection step.
- **Background subtraction / running-average reference** — subtract a long-exposure average to
  remove steady content and leave the transient.
- **Denoise then re-threshold** — a light blur before an edge/gradient step stops compression noise
  from masquerading as structure.

**Rule of thumb:** name the *feature* you can't see (a mottle, a seam, a shift, a period), then
pick the transform that maps that feature to a large, isolated response — edges for outlines,
local-contrast for faint repeats, a channel/ratio for color, a diff/flow for motion, a mask to
shut out everything else. Compose a couple; don't reach for one and hope.

---

## Cheat sheet

| I want… | do this | watch out for |
|---|---|---|
| A **real clock** on motion | headed `record_video` @ 25 fps | headed+GPU, not headless; long enough settle |
| "Is it *actually* animating?" | `active_frac_dF>2` + `app_update_peak` | is the median frame-diff ≈ 0 (black/race)? |
| The dominant **period** | `wave_period_s` (region-luminance autocorr) | is the period above the Nyquist floor of the *measured* fps? |
| A **picture** of the motion | the **filmstrip** (X×Y grid of labeled frames) | state the grid size (e.g. 4×4 = 16 frames); label each with real time |
| **Color / texture** parity | **lossless screenshots**, not the video | never pull a power spectrum from the lossy WebM |

**One-liner:** *screenshots give you pictures; a real-environment video gives you a clock; a
filmstrip is the clock made visible. Measure the distinct-content rate to trust the clock, keep
the heavy frame work out of the REPL, and reserve lossless captures for the spatial work.*
