# ChatGPT unpersonalized discovery extraction

Skill: `chatgpt-unpersonalized-discovery`
Domains: `chatgpt.com`, `www.chatgpt.com`

## Workflow for a supplied prompt list

1. Check saved prompt/run IDs to prevent duplicate submissions.
2. Navigate using the navigation tool to `https://chatgpt.com/?temporary-chat=true` for each prompt.
3. Select **Personalization → Unpersonalized** and verify the page states: “This chat will ignore memory, plugins, and custom instructions.” Fail closed if not verified.
4. Submit the exact supplied prompt.
5. Poll in short tool calls until the response is complete, there is no Stop button, and response text is stable across two polls. Do not mistake a preamble for a final answer.
6. Save a response checkpoint immediately.
7. Open the response’s **ellipsis → View sources**. Do not use citation badge buttons for URL extraction.
8. Wait for the panel to finish rendering, then expand **Show N more**. Capture every entry’s title, exact URL, site, and excerpt, preserving main Sources and More as separate sections.
9. Validate expected and captured source counts, titles, and HTTP(S) URLs. Save and read back both files before leaving the chat.
10. On timeout inspect the current page and saved checkpoints before retrying. Do not blindly resubmit or abandon an uncaptured panel.

## Output format

JSONL, optionally with `.json` extensions for preview. One response per line in `responses.json`; one source-panel entry per line in `sources.json`.

### Response
```json
{"record_id":"batch-p001-r01","prompt_id":1,"run":1,"prompt":"...","response_text":"...","conversation_url":"...","captured_at":"...","model_label":"High","personalization_mode":"unpersonalized","personalization_verified":true,"personalization_verification":{},"mentions":[],"source_counts":{"main":5,"more":45},"sources_complete":true,"source_status":"captured"}
```

### Source
```json
{"record_id":"batch-p001-r01","section":"main","position":1,"title":"...","url":"https://...","canonical_url":"https://...","site":"...","excerpt":"..."}
```

- Recursively sort keys. Preserve array and source order.
- Preserve exact URLs; strip known tracking parameters only in a separate canonical URL.
- Preserve repeated entries; deduplicate only in derived analysis.
- More entries are additional results, not necessarily cited sources.
- First textual mention order is not recommendation rank; track those separately.
- Track requested competitor aliases and retain full text for identifying additional competitors.
- Use `.txt` backing files for read–append–save. `getArtifact()` automatically parses `.json`, which conflicts with JSONL. There is no true append API.
- Prefer per-prompt checkpoints. Avoid bulky HTML in cumulative files.

## Validation

- Every requested prompt/run ID present exactly once.
- Unpersonalized verified before every submission.
- Every source has a title and HTTP(S) URL.
- Captured sources equal initially visible entries plus the Show N more count.
- Response source counts match joined source records.
- Zero sources requires no citation badges, no response links, and no View sources menu item—not simply an empty loading panel.
- Save a final audit artifact; never claim citation completeness from badge labels or favicon domains.

## Browser library API

The saved skill injects `window.discoveryChat`:

- `await discoveryChat.prepare()` — select and verify unpersonalized fresh chat.
- `await discoveryChat.submit(prompt)` — submit exact prompt.
- `discoveryChat.response()` — completion state and response data.
- `await discoveryChat.openSources()` — open Sources or verify no sources.
- `await discoveryChat.sources()` — expand and extract; poll until `ready`.
- `discoveryChat.closeSources()` — dismiss panel.

Example orchestration:
```js
await navigate({url:'https://chatgpt.com/?temporary-chat=true'});
const verification = await browserjs(() => discoveryChat.prepare());
await browserjs(p => discoveryChat.submit(p), prompt);
// Poll in separate bounded calls and require stable complete text twice.
const response = await browserjs(() => discoveryChat.response());
// Save checkpoint before proceeding.
const opened = await browserjs(() => discoveryChat.openSources());
const sources = await browserjs(() => discoveryChat.sources());
// Repeat sources() while pending; validate/save before navigating away.
```

## UI implementation notes

- Personalization and response ellipsis dropdowns may require a synthetic `pointerdown`, not `.click()`.
- Personalization option and confirmation use English text because no stable semantic option ID was found. This is language-sensitive.
- View sources uses structural selector `[role="menuitem"] use[href$="#codex-icon-book-open-light-16"]`.
- Sources panel can be `[role="dialog"][aria-label="Sources"]` or `[role="complementary"][aria-label="Sources"]` depending on layout.
- Source badges render buttons without `href`; the full Sources panel renders anchors with exact destinations.
- Delayed navigation notifications may be stale; inspect the actual active tab.
- Navigation must use the navigation tool/helper, never page JavaScript location/history.
- Change only per-chat personalization, not account-wide settings.
- Ask for visual confirmation when behavior or selectors change.

## Related artifacts

`discoveryChat-library.js` contains the browser helper implementation. The skill manager contains the reusable installed skill.
