---
name: backups
description: >
  Choose this before risky changes to capture a full local repo snapshot
  (tracked, untracked, and .git) for fast rollback.
---

Use this when you want a belt-and-suspenders recovery point beyond normal git workflows.

## Why use it

- Lowers risk during high-impact edits by giving the agent a full restore point
- Captures the entire working repo state, not just tracked commits
- Provides a simple rollback path before destructive operations
- Works offline with standard system tools

## When to use

- Before risky bulk edits, destructive scripts, or major environment changes
- Before reorganizing repository structure
- Before handoffs where you want a portable snapshot artifact

## When NOT to use

- For routine version control operations (`git restore`, `git revert`, branches)
- When you need automated scheduled backups (this workflow is manual)
- When offsite durability is mandatory and not yet configured

## Usage

Create a snapshot:

```bash
timestamp=$(date +%Y-%m-%d_%H-%M-%S)
tar -czvf ~/backups/autocatalytic-infra_${timestamp}.tar.gz -C ~/code autocatalytic-infra
```

Restore/inspect a snapshot:

```bash
tar -tzvf ~/backups/autocatalytic-infra_YYYY-MM-DD_HH-MM-SS.tar.gz
tar -xzvf ~/backups/autocatalytic-infra_YYYY-MM-DD_HH-MM-SS.tar.gz -C /tmp
```

## Examples

```bash
ls -lh ~/backups/
diff -r /tmp/autocatalytic-infra ~/code/autocatalytic-infra
```

## Output

- Artifact: `~/backups/autocatalytic-infra_<timestamp>.tar.gz`
- Includes tracked files, `.git/`, and untracked files under the repo directory

## How it works (brief)

1. Archives `~/code/autocatalytic-infra` with `tar`
2. Compresses to a timestamped `.tar.gz` in `~/backups`
3. Recovery is inspect/extract/verify before replacement

## Cost / benefit summary

- **Cost:** manual operation, local disk usage, no built-in offsite guarantees
- **Benefit:** high-confidence rollback point with very low tooling complexity
