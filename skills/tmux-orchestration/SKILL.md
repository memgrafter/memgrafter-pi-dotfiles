---
name: tmux-orchestration
description: Delegate independent work to pi agents in separate tmux windows — session setup, pi boot polling, task dispatch, progress monitoring, mid-flight steering, Enter fallback, and cleanup. Use when orchestrating parallel pi agents via tmux.
---

## Parallel Agent Orchestration (tmux)

Delegate independent work to `pi` agents in separate tmux windows in a new named session. Poll them, steer if they go off track.

```bash
# Create session (window 1) + add N more windows
tmux new-session -d -s <name> -c .
tmux new-window -t <name>:2 -c . -n <label>  # creates window 2

# Boot + send task (two steps: boot pi, poll until ready, then send)
tmux send-keys -t <name>:2 'pi' C-m
tmux capture-pane -t <name>:2 -p -S -20
tmux send-keys -t <name>:2 "<your task>" C-m

# Poll progress
tmux capture-pane -t <name>:2 -p -S -5

# Steer mid-flight
tmux send-keys -t <name>:2 "Fix X" C-m

# Cleanup when done
tmux kill-session -t <name>```
```

### General Key Rules

- **No need to kill sessions first.** Create fresh session names (`spot_N`, `run_N`) to avoid conflicts.
- **No need to inject AGENTS.md or set system prompts.** The pi harness loads `~/.agents/AGENTS.md` automatically before the first message.
- **Use the intended model** Use the same model as your pi session model (never guess, check your own tmux pane or ask the user) with `--model <model>`** unless explicitly given a model string.
- **Poll for boot, don't sleep.** Bash and pi launch quickly. Poll `tmux capture-pane` every 3 seconds for the shell prompt, 🔥 or $PS1 in ~/.bashrc, or pi version string (`pi v`). Never `sleep 60` or `sleep 90` waiting for boot — that wastes context and risks abort.
- **Poll actively.** Check panes every 30-60s during generation. If an agent is stuck or going off track, send a correction — don't wait for it to finish wrong.
- **Use `C-m`, never `Enter`.** `C-m` is cross-platform stable. If tmux extended-keys is off it will fail, you can then test with `tmux show -gv extended-keys` and use the Enter fallback below. Inform the user of tmux send-keys exceptions before continuing.
- **macOS: `C-m` can silently fail to submit even with `extended-keys` ON.** Observed on a Mac (tmux `extended-keys on`): `tmux send-keys -t pane "<task>" C-m` typed the text into pi's input box but the Enter never registered — the prompt sat unsubmitted while the token counter stayed at `0.0%`. The `extended-keys` value does NOT reliably predict this. **Always verify the prompt actually submitted** (the text moves from the input box up into the transcript above the status bar, and the counter starts moving) before assuming it's in flight. If it didn't submit, send a bare `C-m` (or `Enter`) as a separate call to fire the already-typed text. When in doubt on macOS, prefer the two-call pattern (text, then Enter) from the fallback below.


### Enter Fallback (when extended-keys is off)

**Poll for the shell prompt first** — sending keys before the pane is ready produces garbage (`pi--`, `pi\n`, etc).

**Never combine text and Enter in one command.** `tmux send-keys -t target 'pi' Enter` silently fails with `extended-keys off` — the pane shows `pi` but Enter never registers. Do NOT use `-- Enter`, `C-m`, or quote Enter.

```bash
# Create session
tmux new-session -d -s <name> -c .

# Poll until shell prompt appears (🔥 is the prompt marker), then send
tmux send-keys -t <name>:2 'pi'
tmux send-keys -t <name>:2 Enter

# Send task — two separate calls, never combine text and Enter
tmux send-keys -t <name>:2 "<your task>"
tmux send-keys -t <name>:2 Enter
```


### Indicator of Active Progress
When checking tmux panes for pi agent work, look for the token counter line at the bottom: `↑X.Xk ↓X.Xk  X.X%/160k model-name • thinking off`. An upward-moving `↑` byte count means the model is generating tokens. A static `↑` count means the model is stalled or waiting on a tool call response. The `↓` count shows tool output bytes. If both are unchanged, the agent is idle.
