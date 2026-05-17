# pi-dynamic-tools

Load tool definitions into conversation context on demand without touching the system prompt or breaking prefix cache.

## Install

```bash
pi install git:github.com/memgrafter/pi-dynamic-tools
```

## What it does

Dynamic tools injects tool definitions as conversation messages. The LLM sees the definition and can follow its instructions, but nothing is registered in pi's tool runtime and the system prompt is never modified.

There are two kinds of dynamic tool:

- **Skill-based** — name resolves to a discovered SKILL.md file. The full file content becomes the definition.
- **Description-based** — you provide a name and an inline description. No skill lookup.

Both can be pre-configured in settings or loaded/unloaded at runtime via slash commands.

## Settings

Add to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project-local):

```json
{
  "dynamicTools": {
    "skill-tools": ["quick-report", "shell-analyzer"],
    "tools": {
      "deploy": "Deploy the application to the specified environment using the deploy script at ./scripts/deploy.sh",
      "sequential_thinking": "Think step by step through complex problems before writing code"
    }
  }
}
```

| Key | Type | Description |
|-----|------|-------------|
| `dynamicTools.skill-tools` | `string[]` | Skill names resolved via standard skill discovery paths |
| `dynamicTools.tools` | `Record<string, string>` | Name → description pairs for description-based tools |

Settings from both global and project-local files are merged. First occurrence of a name wins (global is read first).

Tools configured in settings are loaded automatically at session start.

## Commands

### `/dynamic-tool-load <name>`

Load a skill as a dynamic tool. The name must match a discovered skill directory containing a `SKILL.md`.

```
/dynamic-tool-load quick-report
```

### `/dynamic-tool-load <name> <description>`

Load a description-based tool. The first token is the name; everything after it is the description.

```
/dynamic-tool-load deploy Deploy the app to staging or production using ./scripts/deploy.sh
```

### `/dynamic-tool-unload <name>`

Remove a dynamic tool from the loaded set and notify the LLM it has been removed.

```
/dynamic-tool-unload quick-report
```

### `/dynamic-tool-list`

Show the names of all currently loaded dynamic tools.

## Skill discovery

Skills are discovered from the same paths pi uses:

| Path | Scope |
|------|-------|
| `~/.agents/skills/*/SKILL.md` | Global |
| `~/.pi/agent/skills/*/SKILL.md` | Global |
| `.pi/skills/*/SKILL.md` | Project-local |
| `.agents/skills/*/SKILL.md` | Project-local |

The directory name is the skill name. First match wins when the same name appears in multiple paths.

## How it works

### Loading

When a dynamic tool is loaded (from settings or via command), the extension:

1. Resolves the definition (reads SKILL.md or uses the provided description)
2. Stores it in an in-memory map
3. Sends a conversation message listing all currently loaded tools:

```
System:
Dynamic Tool Added:
	- quick-report: <full SKILL.md content>
	- deploy: Deploy the app to staging or production...
```

The message is appended at the current position in the conversation. It does not modify any previous messages or the system prompt.

### Unloading

When a dynamic tool is unloaded:

1. Removes it from the in-memory map
2. Sends a conversation message notifying the LLM:

```
System:
Dynamic Tool Removed:
	- quick-report
```

The removal message does not include the definition. It tells the LLM to stop following those instructions.

### What happens at session start

If settings contain dynamic tools, each one is loaded during `session_start`. This means the load messages appear at the very beginning of the conversation and become part of the cached prefix for all subsequent turns.

## Cache behavior

This extension is designed to never invalidate prefix cache.

| Operation | Cache impact |
|-----------|-------------|
| Load from settings (session start) | Messages at conversation start. Become part of prefix cache for all subsequent turns. No invalidation. |
| Load via slash command (mid-session) | Message appended after existing conversation. Previous prefix stays cached. New prefix includes the load message on the next turn. |
| Unload via slash command | Message appended after existing conversation. Previous prefix stays cached. |
| System prompt | Never modified. |
| Tool registry | Never modified after init. |

**Key rule**: definitions are injected as conversation messages only. The system prompt and tool registry are never touched.

## Tradeoffs

- **Context window cost** — loaded definitions consume tokens permanently until compaction. A large SKILL.md (like quick-report at ~8K tokens) stays in context for every turn after loading.
- **No execution** — dynamic tools provide context only. The LLM follows the instructions using pi's existing tools (read, write, bash, etc.). There is no custom tool execution.
- **No undo** — unloading sends a removal message but cannot delete the original load message from conversation history. The original definition remains in context until compaction.
- **In-memory only** — the loaded tool set does not persist across session restarts. Tools configured in settings are re-loaded on each session start. Runtime-loaded tools are lost.

## Example: quick-report

```
/dynamic-tool-load quick-report
```

This reads `~/.agents/skills/quick-report/SKILL.md` and injects it as a conversation message. The LLM now knows how to generate self-contained HTML reports using vendored Plotly, Mermaid, and KaTeX — without you needing to explain the patterns manually.

```
Generate a report showing the distribution of file types in this project
```

The LLM follows the quick-report skill instructions to produce a single `.html` file with charts, tables, and proper vendor paths.

## Example: inline description

```
/dynamic-tool-load plan-mode When asked to plan, create a numbered list of steps before writing any code. Review the plan with the user before proceeding.
```

The LLM receives a message with this instruction and follows it for the rest of the session.
