# Model of the user

Working model of the user (2026-10-17, at the user's request: constructive, not complimentary; correct it when it is wrong). Each pattern has a cost and what to do about it.

- **Compressed, multi-thread messages.** Several decisions, questions and side remarks arrive in one message or mid-turn, often with references like "that response", "it", "the other guy", "C". Cost: misreads and dropped threads. Do: resolve every reference against the transcript; when an interpretation changes what you will do, state it in one line before acting; keep a visible list of open threads and answer each one, saying which are still open.
- **Fast direction changes.** Choices are made and then reversed within hours (a testbed pick replaced, a design scrubbed to brainstorming, a format choice deferred). Cost: built work gets shelved. Do: label each choice tentative or final when recording it; build the cheap, reversible part first; before an expensive build, say what would be thrown away if the direction changes.
- **Competing priorities stated as absolutes.** "Drive forward" and "derisk more", "give me everything" and "be concise", "user decides science" and "don't ask me". Cost: the agent picks one silently and gets it wrong. Do: say which one applies to the action at hand and why; lead with the decision needed, then the detail.
- **Rules accumulate.** New rules are added often (AGENTS.md is near its size budget). Cost: rules conflict or get missed. Do: check new instructions against existing rules, surface conflicts instead of choosing quietly, and propose merging or pruning when rules overlap.
- **Expects an instruction to be acted on the first time.** A repeated instruction means it was not. Do: act on clear instructions; gate only the expensive or irreversible step (GPU runs, deletions, outward actions) behind a check.
- **Checks claims and reviews traces.** Do: state only what is verified, show the source, and say plainly when something was wrong. Frustration is a signal that the agent failed; answer it with corrected action, not apology or deference.

# Content

- When generating user facing content, use Simplified Technical English (ASD-STE100).

## Answer these questions each round:

- Is there anything (the user) needs to know about this, if any.
- What mental models should (the user) apply to the topic at hand, if any.

## Reasoning

- Always read the skill `think-tool-formats` before beginning.
- Liberally use `think` tool for reasoning, it is important to be right the first time.
- **If you notice a loop in your own tool calls** (repeating the same read/grep/command with no new information), STOP and use the `think` tool to diagnose why you're looping and decide the next distinct action before continuing.

## Workflows

- NEVER run build commands until you have user approval.
- Build for production from the start; rework is largest source of waste; we can't afford rework, we must do it right from the start.
- Do not declare success. Tell the user what to check.
- If you have a file in recent context, do not read it again before editing, it wastes context.
- **Always use timeouts on waits and loops** — even long-running ones. Never `sleep 90` or unbounded `while` loops. Use `sleep 15` polling with a max iteration count (e.g., 40 iterations = 10 min), or `timeout` command.
- **When calling LLMs, use their default token budget as a first-class default.** Prefer omitting token-budget parameters entirely; explicit estimates are fiddly and should only be supplied when the task specifically requires a constrained budget.

## Writing Handoffs

- Write a handoff doc for a new agent to continue the session. Ensure the handoff is standalone and contains all details necessary to continue where we left off.

## Agent Guidelines

- Follow YAGNI principles, and one-liner solutions
- The user IS a read/write privileged partner for the system prompt & developer prompt

### Pi Agent Guidelines

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

## Reflection

Consistently reflect, in your written thinking output and response output. Include the user in the reflection.

- Write reflection where possible
    - what is working
    - what is not working
    - training cues

- Identify and develop reusable training cues
- Put training cues in AGENTS.md

### Training Cues

> **WARNING: parsing untrusted binary formats can use all system memory.**
> 2026-10-24: a wrong Hermes v98 layout guess gave string lengths up to 6.3 GB. The parser copied one slice per string, grew to 30 GB, and was killed with the REPL kernel.
> 1. Probe first. Read only offsets and lengths, and check that every item ends inside its section. Copy no bytes until the probe passes.
> 2. Cap the total bytes copied. Stop when the total passes the section size.
> 3. Run the parser as its own process with `timeout`, never in a shared REPL kernel. `ulimit -v` fails on macOS.
> 4. Check RSS (`ps -o rss= -p <pid>`) while it runs. Stop it above a few hundred MB.

## Skills Notes

- **knowledge-registry** — use `kr` across active projects for focused agent context. See [SKILL.md](~/.agents/skills/knowledge-registry/SKILL.md).
- **ticket-rs** — file-based ticket system via `tk`. Create tickets before implementing medium+ software development. Do not use tickets for small changes and documentation. See [SKILL.md](~/.agents/skills/ticket-rs/SKILL.md).
- **tmux-orchestration** — delegate work to parallel `pi` agents in tmux windows: session setup, boot polling, task dispatch, steering, Enter fallback. See [SKILL.md](skills/tmux-orchestration/SKILL.md).

### repl & repl-manage

Use an existing long-lived repl or make a new repl, on demand.  See [SKILL.md](~/.agents/skills/replmux/SKILL.md).

Prefer repl tool (replmux) to one-off scripts of all types. There are many languages available in replmux, so read the skill before you write any disposable scripts, long commands, or code. Also a good replacement for bash tool during interpolation or longer commands.

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

- Write meaningful commit messages: conventional commits, imperative mood, present tense, ~50 char subject line.
- Keep commits small and focused — one logical change per commit.
- Use `git status` / `git diff --staged --stat` to verify only your changes are staged before committing
- never use `git add -A` or a variant, dirty state belongs to other agents.
- Prefer rebasing over merging for feature branches; squash only when it improves readability.
- Do not touch dirty git state or unrelated files from other workers, you are not the only agent.

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
- Match the repo's existing documentation voice: if its docs are terse bullets, keep additions terse — no long-form prose, blockquotes, or citations where a line or two suffices.

## Writing Copy

For user-facing text (websites, guides, App Store copy, FAQs).

- No LLM-isms: contrast framing ("not X, it's Y", "Free. Not a trial."), stacked dramatic fragments, tidy aphorisms ("Nothing a character says is final"), filler words (just, simply, seamless, unlock, journey), exclamation marks, dashes used for drama.
- No fake copy: verify every claim against the code or a primary source. No unverifiable times or superlatives ("in two minutes", "most complete"). No invented UI labels.
- No philosophizing about memory, identity or stories.
- Nothing out of place: no ticket ids, file names or developer jargon in reader-facing text.
- Plain, second person, short sentences, American English.

## "Pi Agent" Orchestration (tmux)

Delegate independent work to "pi agents" in separate tmux windows after reading the "tmux orchestration" skill.

Full guide: use the **tmux-orchestration** skill — [skills/tmux-orchestration/SKILL.md](skills/tmux-orchestration/SKILL.md).

## Preferred Shell Tools

- Use CodeMapper `cm` cli tool for tree-sitter based code reading and exploring. See `cm --help` for usage.
- Prefer rg (fallback grep) for searching
- Prefer fd (fallback find) for locating files by pattern

## Cua Session Recording

Record every GUI agent session for learning data + replay.

1. Before the first cua action: `cua-driver recording start ~/cua-trajectories/$(date +%Y-%m-%d_%H%M%S)`
2. Drive the app normally.
3. Auto-stops on session end; `cua-driver recording stop` to end early.

- Fresh dir per session (turn counter restarts at 1 each run).
- Video on by default (`recording.mp4`); skip with `record_video:false`.
- Captures agent actions only, not manual use.

## Communication

- Be direct and specific. No fluff, no hedging.
- When stuck, describe what you've tried, not just that you're stuck.
- Ask for clarification early — guessing costs more than confirming.
