---
name: deliver
description: Turn an approved draft into one file per platform, each with its own App Store campaign QR that is proven to decode, plus the compliance checks (18+ and machine-generated line, H3 log, AI toggle), in one command. Use when the owner approves a draft for posting.
---

# Platform versions

## When to use
- The owner has approved a draft and wants files to post. Not before: drafts under review use one QR (or none).

## Run
```bash
cd production/h3
python3 -I deliver.py draftNN <campaign> [video=what-do-you-do] [endcard=D] [platforms=tik,igr,yt,tw,fnf]
# e.g. python3 -I deliver.py draft31 notyourfirstdelve-20261105
```
It renders each platform's QR with the website's own library and settings, builds `draftNN-<p>` with `make_draft.py`,
decodes every QR from the finished video's last frame, and prints OK/FAIL per file. About 12 s per platform (2026-11-05).

## Campaigns
- Link: `https://apps.apple.com/app/apple-store/id6747638829?pt=119115869&ct=<campaign>-<p>&mt=8`; ct is at most 30 characters.
- The owner makes or names the campaigns; links work without saving them in App Store Connect (owner, 2026-11-05: fine).
  Data shows after at least 24 h and 5 installs.
- Codes: tik TikTok, igr Instagram Reels, yt YouTube Shorts, tw X/Twitter, fnf friends and family.

## Compliance checks before handing over (repo AGENTS.md)
1. End card: "18+ · Characters, voices and video are machine-generated" in the last 0.5 s (look at the last frame and at
   0.6 s before the end).
2. Every H3 clip in the cut is in `h3/log.jsonl` (`h3.py pull` does this); composites list their parts.
3. Tell the owner to set each platform's own AI-content label when posting. Nothing is posted by an agent.
4. Avoid trademarked phrases on screen ("Choose Your Own Adventure" is Chooseco's; the card says "TURN TO PAGE 47.").

## Hand over
A numbered list of the files with their OK lines, the campaign names, and anything the owner must do when posting.
