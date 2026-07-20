## Workflows

- NEVER run build commands.
- Build for production from the start; rework is largest source of waste; we can't afford rework, we must do it right from the start.
- Do not declare success. Tell the user what to check.
- If you have a file in recent context, do not read it again before editing, it wastes context.
- If the user says 'mark' or similar, use bash tool `date` to inject a timestamp into the session
- **Always use timeouts on waits and loops** — even long-running ones. Never `sleep 90` or unbounded `while` loops. Use `sleep 15` polling with a max iteration count (e.g., 40 iterations = 10 min), or `timeout` command.

## SKILLS

- **knowledge-registry** — use `kr` across active projects for focused agent context. See [SKILL.md](~/.agents/skills/knowledge-registry/SKILL.md).
- **ticket-rs** — file-based ticket system via `tk`. Create tickets before implementing work. See [SKILL.md](~/.agents/skills/ticket-rs/SKILL.md).

## Tickets via REPL

Manage `tk` tickets from the Python REPL using `subprocess` — avoids bash escaping entirely (args passed as a list, not a shell string).

```python
import subprocess

def tk(*args):
    r = subprocess.run(['tk', *args], capture_output=True, text=True)
    return r.stdout.strip()

# Create
id = tk('create', 'Fix the thing', '-t', 'bug', '-p', '1')
# id -> 'mul-abc1'

# Start / close
tk('start', id)
tk('close', id)

# Add note (works with $(), <>, backticks, quotes — no escaping)
tk('add-note', id, 'Fix: run `$()`, check `<div>`, match "quotes"')

# Query
tk('ls', '--status', 'open')
tk('show', id)
tk('dep', id, 'mul-xyz9')
```

## Git & Commits

- Write meaningful commit messages: imperative mood, present tense, ~50 char subject line.
- Keep commits small and focused — one logical change per commit.
- Run `git diff --stat` before committing so you know exactly what's changing.
- Prefer rebasing over merging for feature branches; squash only when it improves readability.
- Do not touch unrelated files from other workers, you are not the only agent.

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

### Indicator of Active Progress
When checking tmux panes for pi agent work, look for the token counter line at the bottom: `↑X.Xk ↓X.Xk  X.X%/160k model-name • thinking off`. An upward-moving `↑` byte count means the model is generating tokens. A static `↑` count means the model is stalled or waiting on a tool call response. The `↓` count shows tool output bytes. If both are unchanged, the agent is idle.

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

**Key rules:**

- **Poll for boot, don't sleep.** Bash and pi launch quickly. Poll `tmux capture-pane` every 3 seconds for the shell prompt (`🔥`) or pi version string (`pi v`). Never `sleep 60` or `sleep 90` waiting for boot — that wastes context and risks abort.
- **Use `C-m`, never `Enter`.** `C-m` is cross-platform stable. If tmux extended-keys is off it will fail, you can then test with `tmux show -gv extended-keys` and use the Enter fallback below. Inform the user of tmux send-keys exceptions before continuing.

### Enter Fallback (when extended-keys is off)

**Poll for the shell prompt first** — sending keys before the pane is ready produces garbage (`pi--`, `pi\n`, etc).

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

Do NOT use `-- Enter`, `C-m`, or quote Enter. Just `tmux send-keys -t target Enter`.
- **Poll actively.** Check panes every 30-60s during generation. If an agent is stuck or going off track, send a correction — don't wait for it to finish wrong.
- **No need to inject AGENTS.md or set system prompts.** The pi harness loads `~/.agents/AGENTS.md` automatically before the first message.
- **No need to kill sessions first.** Create fresh session names (`spot_N`, `run_N`) to avoid conflicts.
- **Use the intended model** Use the same model as your pi session model (never guess, check your own tmux pane or ask the user) with `--model <model>`** unless explicitly given a model string.

## Tools

- Use CodeMapper `cm` cli tool for tree-sitter based code reading and exploring. See `cm --help` for usage.
- Prefer rg (fallback grep) for searching
- Prefer fd (fallback find) for locating files by pattern
- Use `git status` / `git diff` to verify only your changes are staged before committing, never use `git add -A` or a variant, dirty state belongs to other agents.

## Communication

- Be direct and specific. No fluff, no hedging.
- When stuck, describe what you've tried, not just that you're stuck.
- Ask for clarification early — guessing costs more than confirming.
