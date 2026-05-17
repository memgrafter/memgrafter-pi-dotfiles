# pi-claude-cache-warming

Claude OAuth cache warming extension for **pi**.

## Why

For Claude subscription users, prompt cache expires after idle periods:
- **Pro plans**: ~5 minutes
- **Max plans**: ~1 hour

This extension sends out-of-band keepalive requests to keep your context warm without polluting your conversation.

## Quick Start

Add to `~/.pi/agent/settings.json`:

**Pro plan** (5-minute cache expiry, ~25min coverage):
```json
{
  "cachewarm": {
    "enabled": true,
    "mode": "5m",
    "maxConsecutive": 4
  }
}
```

**Max plan** (1-hour cache expiry, ~2h coverage):
```json
{
  "cachewarm": {
    "enabled": true,
    "mode": "1h",
    "maxConsecutive": 1
  }
}
```

All settings and defaults:
```json
{
  "cachewarm": {
    "enabled": false,         // default: false
    "mode": "1h",             // default: "1h" — "5m" for Pro, "1h" for Max
    "maxConsecutive": 1       // default: 1 — max auto-warms before user activity (0=disabled, -1=unlimited)
  }
}
```

These are global defaults. Per-session overrides via `/cachewarm` commands take priority.

## Behavior

- Targets **Anthropic + OAuth** only (`/login` flow)
- Skips Anthropic API-key sessions (use `PI_CACHE_RETENTION=long` there)
- Two modes:
  - `5m` (Pro): warms after 4m45s idle, repeats every 5min
  - `1h` (Max): warms after 58.5min idle, repeats every 59min
- Does not inject keepalive messages into your visible conversation
- Logs warm results as chat messages (not sent to LLM)
- Tracks last cache activity from LLM responses and tool calls
- Stops after `maxConsecutive` auto-warms until next user interaction (0=disabled, -1=unlimited)
- Cache activity timer resets on restart (shows "never" until first LLM interaction or warm)
- Shows status in bottom bar when enabled: `cachewarm (int:5m, last:30s ago)`

## Commands

- `/cachewarm` — toggle on/off (session)
- `/cachewarm on` — enable (session)
- `/cachewarm off` — disable (session)
- `/cachewarm 5m` or `/cachewarm pro` — set to 5-minute mode (session)
- `/cachewarm 1h` or `/cachewarm max` — set to 1-hour mode (session)
- `/cachewarm status` — show detailed status
- `/cachewarm now` — warm immediately (bypasses cap)

## Optional startup flag

- `--cachewarm` — enable for this session

## Install

### As a pi package

```bash
pi install git:github.com/memgrafter/pi-claude-cache-warming
```

Project-local:

```bash
pi install -l git:github.com/memgrafter/pi-claude-cache-warming
```

### Via settings.json extensions path

Add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/code/pi-claude-cache-warming/extensions/pi-claude-cache-warming.ts"
  ]
}
```

### Direct

```bash
pi -e ./extensions/pi-claude-cache-warming.ts
```
