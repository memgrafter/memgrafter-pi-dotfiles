## Workflows

- Build for production from the start; rework is largest source of waste; we can't afford rework, we must do it right from the start.
- Do not declare success. Tell the user what to check.
- If you have a file in recent context, do not read it again before editing, it wastes context.
- If the user says 'mark' or similar, use bash tool `date` to inject a timestamp into the session

## Git & Commits

- Write meaningful commit messages: imperative mood, present tense, ~50 char subject line.
- Keep commits small and focused — one logical change per commit.
- Run `git diff --stat` before committing so you know exactly what's changing.
- Prefer rebasing over merging for feature branches; squash only when it improves readability.

## Coding Standards

- Favor explicit over implicit: name variables clearly, avoid magic numbers, extract constants.
- Write functions that do one thing; if it needs "and" in its purpose, split it.
- Add comments only for *why*, not *what* — the code should express what.
- Handle errors at the boundary; don't leak implementation details to callers.

## Testing

- Write tests alongside features, not after. Tests prove intent and prevent regressions.
- Prefer integration or end-to-end tests over unit tests when they're equally easy — they catch real bugs.
- Test failure cases too: edge conditions, invalid input, timeouts.

## Documentation

- Keep docs close to the code: README at repo root, inline docs where needed.
- Update docs with every meaningful feature change; stale docs are worse than no docs.
- Use examples over prose when possible — a runnable example teaches faster.

## Parallel Agent Orchestration (tmux)

Delegate independent work to `pi` agents in separate tmux windows in a new named session. Poll them, steer if they go off track.

```bash
# Create session (window 1) + add N more windows
tmux new-session -d -s <name> -c .
tmux new-window -t <name>:2 -c . -n <label>  # creates window 2

# Boot + send task (two steps: boot pi, wait for ready pane, then send message)
tmux send-keys -t <name>:2 'pi' C-m
# Do not use sleep; verify pi is ready for input before sending.
tmux capture-pane -t <name>:2 -p -S -20
# pi harness auto-loads ~/.agents/AGENTS.md before first message
tmux send-keys -t <name>:2 "<your task>" C-m

# Poll progress
tmux capture-pane -t <name>:2 -p -S -5

# Steer mid-flight
tmux send-keys -t <name>:2 "Fix X" C-m

# Cleanup when done
tmux kill-session -t <name>```
```

**Key rules:**

- **Windows are 1-indexed.** `sess:1` is the initial window. `new-window -t sess:2` creates index 2.
- **Use `C-m`, not `Enter`.** `Enter` sends the literal string "Enter"; `C-m` sends an actual carriage return.
- **Poll actively.** Check panes every 30-60s during generation. If an agent is stuck or going off track, send a correction — don't wait for it to finish wrong.
- **No need to inject AGENTS.md or set system prompts.** The pi harness loads `~/.agents/AGENTS.md` automatically before the first message.
- **No need to kill sessions first.** Create fresh session names (`spot_N`, `run_N`) to avoid conflicts.
- **Use the intended model** Use the same model as your pi session model (check your own tmux pane or ask the user) with `--model <model>`** unless explicitly given a model string.

## Tools

- Use CodeMapper `cm` cli tool for tree-sitter based code reading and exploring. See `cm --help` for usage.
- Prefer `grep`/`rg` for searching; `find` for locating files by pattern.
- Use `git status` / `git diff` to verify changes before committing.

## Communication

- Be direct and specific. No fluff, no hedging.
- When stuck, describe what you've tried, not just that you're stuck.
- Ask for clarification early — guessing costs more than confirming.
