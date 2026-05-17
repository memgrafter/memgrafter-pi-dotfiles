# pi-dynamic-tools

Pi extension that loads tool definitions into conversation context on demand via message injection.

## Structure

```
extensions/
  pi-dynamic-tools.ts             # Extension entry point
package.json                       # Pi package manifest
README.md                          # User docs
DYNAMIC-TOOLS-DESIGN.md            # Design doc and future plans
```

## Settings key: `dynamicTools`

- `skill-tools: string[]` — skill names resolved via standard discovery paths, loaded at session start
- `tools: Record<string, string>` — name → description pairs for description-based tools, loaded at session start

## Key implementation details

- Definitions are injected as conversation messages via `pi.sendMessage()` — never touches system prompt or prefix cache
- Two flavors: skill-based (name resolves to SKILL.md) and description-based (inline description)
- Core logic lives in standalone functions (`dynamicToolLoad`, `dynamicToolUnload`, `dynamicToolList`) for future reuse as LLM-callable tools
- In-memory `Map<string, string>` tracks loaded tools; does not persist across restarts
- Settings loaded from global (`~/.pi/agent/settings.json`) + project (`.pi/settings.json`), merged with first occurrence winning
