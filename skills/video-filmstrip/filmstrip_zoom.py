#!/usr/bin/env python3
"""Tighter sandwich board: a ZOOM LADDER of filmstrips.

A plain filmstrip samples the whole film at one even spacing -> you see the overall
arc but can't see the detail. This instead stacks several "views", each a HORIZONTAL
strip of `n` frames sampled FORWARD from a start index:

    frames = [start, start+step, start+2*step, ...]        (n cells)

Read top-to-bottom the views go from coarse to fine:
    L0  overall      (wide step, whole film)
    L1  drill-down   (a window of L0, tighter step)
    L2  drill-down on the drill-down  (a sub-window of L1, tighter still)
    ...as many levels as the length of the film needs.

It is like a binary search, but instead of jumping to the midpoint and halving, each
level is a *directional array forwards from the starting index* of the region you want
to focus on. You pick the windows by hand as you look at each level.

Usage:
    filmstrip_zoom.py <frames_dir> <out.png> <views> [--fps 5] [--cell 480x338]

  <frames_dir>  a dir of an already-extracted frame sequence (e.g. the 5fps s_*.png
                from the filmstrip step). Frame i's time is i / --fps seconds.
  <views>       a JSON list of views, OR a path prefixed with '@'. Each view is:
                    [start, end, n]            region form: n cells spanning [start,end)
                                              (step = (end-start)/n)
                    [start, step, n, "step"]  step form: cells at start, start+step, ...
  --fps         the extraction rate of frames_dir (default 5) -- only used for labels.

Example (3-level ladder on a 216-frame 5fps film):
    filmstrip_zoom.py captures/ref_filmstrip REF_ZOOM.png \
        '[[0,216,8],[150,216,8],[180,216,8]]' --fps 5
"""
import sys, json, glob, os
from PIL import Image, ImageDraw


def load_frames(d):
    return sorted(glob.glob(os.path.join(d, '*.png')))


def sample(view, nframes):
    """Return (idxs, mode, step). idxs are clamped frame indices in [0, nframes)."""
    if len(view) >= 4 and view[3] == 'step':
        start, step, n = view[0], view[1], view[2]
        idxs = [int(start + k * step) for k in range(n)]
        mode = 'step'
    else:
        start, end, n = view[0], view[1], view[2]
        step = (end - start) / max(1, n)
        idxs = [int(round(start + k * step)) for k in range(n)]
        mode = 'region'
    idxs = [min(max(i, 0), nframes - 1) for i in idxs]
    return idxs, mode, (idxs[1] - idxs[0]) if len(idxs) > 1 else 0


def main():
    args = sys.argv[1:]
    fps = 5.0
    cell = (480, 338)
    if '--fps' in args:
        i = args.index('--fps'); fps = float(args[i + 1]); del args[i:i + 2]
    if '--cell' in args:
        i = args.index('--cell'); w, h = args[i + 1].split('x'); cell = (int(w), int(h)); del args[i:i + 2]
    frames_dir, out, views_arg = args[0], args[1], args[2]
    views = json.load(open(views_arg[1:])) if views_arg.startswith('@') else json.loads(views_arg)

    fs = load_frames(frames_dir)
    nframes = len(fs)
    if not nframes:
        print('no frames in', frames_dir); sys.exit(1)

    cw, ch = cell
    maxn = max(v[2] for v in views)
    # keep any single row from getting absurdly wide; scale cells down if needed
    scale = min(1.0, 4200.0 / (maxn * cw))
    cw2, ch2 = max(1, int(cw * scale)), max(1, int(ch * scale))
    header_h = 30
    total_w = maxn * cw2
    total_h = sum(ch2 + header_h for _ in views)

    sheet = Image.new('RGB', (total_w, total_h), 'white')
    dr = ImageDraw.Draw(sheet)
    y = 0
    for li, v in enumerate(views):
        idxs, mode, step = sample(v, nframes)
        n = len(idxs)
        dr.rectangle([0, y, total_w, y + header_h], fill=(0, 0, 0))
        if mode == 'region':
            rng = f'frames [{v[0]}..{v[1]})'
        else:
            rng = f'start={v[0]} step={v[1]}'
        t0, t1 = idxs[0] / fps, idxs[-1] / fps
        dr.text((6, y + 7), f'L{li}  {rng}  n={n}  step={step}f   t={t0:.1f}s..{t1:.1f}s',
                fill='yellow')
        y += header_h
        for k, i in enumerate(idxs):
            im = Image.open(fs[i]).convert('RGB').resize((cw2, ch2))
            sheet.paste(im, (k * cw2, y))
            dr.rectangle([k * cw2, y, k * cw2 + 46, y + 20], fill=(0, 0, 0))
            dr.text((k * cw2 + 3, y + 3), f'#{i}', fill='cyan')
        y += ch2
    sheet.save(out)
    print(f'zoom ladder: {out}  {sheet.size[0]}x{sheet.size[1]}  '
          f'{len(views)} levels  (frames {nframes}, {fps} fps)')


if __name__ == '__main__':
    main()
