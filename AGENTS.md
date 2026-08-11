# Content

- When generating user facing content, use Simplified Technical English (ASD-STE100).

## Workflows

- NEVER run build commands.
- Build for production from the start; rework is largest source of waste; we can't afford rework, we must do it right from the start.
- Do not declare success. Tell the user what to check.
- After you work on any implementation, answer this question: "Is there anything the user needs to know about this implementation?"
- If you have a file in recent context, do not read it again before editing, it wastes context.
- **Always use timeouts on waits and loops** — even long-running ones. Never `sleep 90` or unbounded `while` loops. Use `sleep 15` polling with a max iteration count (e.g., 40 iterations = 10 min), or `timeout` command.
- **When calling LLMs, use their default token budget as a first-class default.** Prefer omitting token-budget parameters entirely; explicit estimates are fiddly and should only be supplied when the task specifically requires a constrained budget.

## Agent Guidelines

- Use bash for file operations like ls, rg, find
- Use read to examine files instead of cat or sed.
- Inspect PI_* environment variables for current model and session details.
- Use edit for precise changes (edits[].oldText must match exactly)
- When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls
- Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.
- Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.
- Use write only for new files or complete rewrites.
- Be concise in your responses
- Show file paths clearly when working with files

## SKILLS

- **knowledge-registry** — use `kr` across active projects for focused agent context. See [SKILL.md](~/.agents/skills/knowledge-registry/SKILL.md).
- **ticket-rs** — file-based ticket system via `tk`. Create tickets before implementing medium+ software development. Do not use tickets for small changes and documentation. See [SKILL.md](~/.agents/skills/ticket-rs/SKILL.md).
- **tmux-orchestration** — delegate work to parallel `pi` agents in tmux windows: session setup, boot polling, task dispatch, steering, Enter fallback. See [SKILL.md](skills/tmux-orchestration/SKILL.md).

## repl & repl-manage

Use an existing long-lived repl or make a new repl, on demand.  See [SKILL.md](~/.agents/skills/replmux/SKILL.md).

### Tickets via REPL

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

### Knowledge Registries via REPL

Manage `kr` registries from the Python REPL using `subprocess` — avoids shell escaping and passes each argument unchanged.

```python
import subprocess

def kr(*args):
    r = subprocess.run(['kr', *args], capture_output=True, text=True)
    return r.stdout.strip()

# Create
kr('registry', 'create', 'auth-knowledge')
kr('source', 'add', 'auth-knowledge', 'file:///path/auth.rs#L1-L80', '--label', 'auth module', '--tags', 'core')

# Inspect / retrieve
kr('registry', 'show', 'auth-knowledge')
kr('search', 'auth-knowledge', 'authenticate', '-c', '2')
kr('dump', 'auth-knowledge')

# Update / remove
kr('source', 'list', 'auth-knowledge')
kr('source', 'remove', 'auth-knowledge', '0')

# Delete
kr('registry', 'delete', 'auth-knowledge')
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

Delegate independent work to `pi` agents in separate tmux windows. Full guide: use the **tmux-orchestration** skill — [skills/tmux-orchestration/SKILL.md](skills/tmux-orchestration/SKILL.md).


## Tools

- Use CodeMapper `cm` cli tool for tree-sitter based code reading and exploring. See `cm --help` for usage.
- Prefer rg (fallback grep) for searching
- Prefer fd (fallback find) for locating files by pattern
- Use `git status` / `git diff` to verify only your changes are staged before committing, never use `git add -A` or a variant, dirty state belongs to other agents.

## Communication

- Be direct and specific. No fluff, no hedging.
- When stuck, describe what you've tried, not just that you're stuck.
- Ask for clarification early — guessing costs more than confirming.
