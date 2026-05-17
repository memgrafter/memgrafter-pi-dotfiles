# Dynamic Tools — Design

## Current (v1)

All "tools" are context injected via conversation messages. Two flavors:

- **Skill-based**: name resolves to a discovered SKILL.md, definition = full file content
- **Description-based**: user provides name + inline description

Both can be pre-configured in settings.json or loaded/unloaded at runtime.

### Settings

```json
{
  "dynamicTools": {
    "skill-tools": ["quick-report", "shell-analyzer"],
    "tools": {
      "deploy": "Deploy the application to the specified environment",
      "sequential_thinking": "Think step by step through complex problems"
    }
  }
}
```

- `skill-tools` — array of skill names, resolved via standard skill discovery
- `tools` — map of name → description for description-based tools

Settings-configured tools are loaded at `session_start`.

### Commands

- `/dynamic-tool-load <name>` — resolve as skill
- `/dynamic-tool-load <name> <description>` — description-based
- `/dynamic-tool-unload <name>`
- `/dynamic-tool-list`

### Constraints

- No system prompt modification (prefix cache)
- No mid-session tool registration/mutation
- Message injection only (appended at conversation tail, cache-safe)

### Message format

**Load:**
```


System:
Dynamic Tool Added:
	- tool_name: <full definition>
```

**Unload:**
```


System:
Dynamic Tool Removed:
	- tool_name
```

### In-memory state

- `loaded: Map<string, string>` — name → definition (both flavors)
- `availableSkills: SkillEntry[] | null` — discovery cache

---

## Future

### Multi-tool batch operations

`/dynamic-tool-load foo bar baz` — load multiple skills in one message.

Single message with all entries:
```


System:
Dynamic Tool Added:
	- foo: <definition>
	- bar: <definition>
	- baz: <definition>
```

`/dynamic-tool-unload foo bar` — similar batch removal.

### LLM-callable tools

Register at init time (not mid-session). These call the same core functions:

- `dynamic_tool_search` — search available skills by name/keyword, return matches
- `dynamic_tool_load` — load one or more by name (skill or description)
- `dynamic_tool_unload` — unload one or more by name

### Loading pi tools via dynamic tools

Instead of pi's built-in tool registry, load tool definitions (read, bash, edit, etc.)
as dynamic tools. The LLM gets the definition via message injection and the actual
execution still goes through pi's runtime. This decouples tool awareness from
tool execution.

### Arbitrary definitions (non-skill)

Support loading tool definitions from:
- Raw markdown files
- URL fetch
- Inline text via command argument (done — description-based)

### Session persistence

Use `pi.appendEntry()` to persist load/unload actions so state can be
reconstructed on session restore via `session_start` handler walking entries.
