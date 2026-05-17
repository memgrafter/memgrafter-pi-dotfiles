# pi-tree-prewarm

Creates a cache entry at the `/tree` branch point so navigating back doesn't bust your cache.

## The problem

Anthropic's prompt cache stores entries only at explicit `cache_control` breakpoint positions. Pi places breakpoints at the system prompt and last user message — nowhere in between.

When you `/tree` back to an earlier point:

1. The branch point content IS a prefix of your cached conversation
2. But there's **no cache entry stored at that position** — only at system and the old last message
3. The 20-block lookback walks backwards from your new message checking each block boundary for a stored cache hash — finds **nothing** until it reaches the system prompt
4. Result: system prompt cache hit (~4k tokens), everything else is a full cache WRITE (~66k+ tokens)

The 20-block lookback can only find cache entries that were **explicitly written** by a previous request with a breakpoint at that position. Being a sub-prefix of a larger cached block doesn't help.

## What this does

After `/tree`, sends a **priming request** to create a cache entry at the branch point:

| Step | What happens | Cache behavior |
|------|-------------|----------------|
| 1. `/tree` to branch point | `session_tree` event fires | — |
| 2. Priming request | Sends branch-point prefix + keepalive msg with `cache_control` at branch point | System: cache READ; branch point: cache WRITE |
| 3. User's actual message | Sent with `cache_control` at branch point + last message | 20-block lookback finds branch-point entry → cache READ! |

Without priming, step 3 would be a full 66k+ token cache write. With priming, the write happens in step 2 (which benefits from the system cache), and step 3 gets a cheap cache read (0.1x base price).

## Scope

Only activates when ALL are true:

- Model API is `anthropic-messages`
- System prompt includes Claude Code identity (OAuth mode)
- Fewer than 4 breakpoints already exist
- Branch point block doesn't already have `cache_control`

## Install

Already in `~/.pi/agent/settings.json`. Run `/reload` to pick up changes.

## Debug

```bash
export PI_TREE_PREWARM_DEBUG=1
```

Shows notifications when breakpoints are injected and priming completes.
