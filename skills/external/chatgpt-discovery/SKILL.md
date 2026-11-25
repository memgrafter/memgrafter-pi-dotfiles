---
name: chatgpt-unpersonalized-discovery
description: Capture fresh unpersonalized ChatGPT responses and source panels with resumable checkpoints.
---

# ChatGPT unpersonalized discovery

**Domains:** `chatgpt.com`, `www.chatgpt.com`  
**Browser library:** [`discoveryChat-library.js`](./discoveryChat-library.js), injected as `window.discoveryChat`.

## Workflow

1. Check saved prompt/run IDs and exports to avoid duplicates. Before a new submission, ensure at least 60 seconds have elapsed since the previous submission. The runner owns pacing, persistence, and recovery; the library only handles browser interactions.
2. Navigate with the navigation tool to `https://chatgpt.com/?temporary-chat=true`. Call `prepare()` to verify that the fresh chat is unpersonalized. Never change account-wide settings. The menus use keyboard Enter and `aria-controls`; the English menu labels and confirmation banner are language-sensitive.
3. Save a `submission_pending` checkpoint before sending. Call `submit(prompt, expectedModel)` with the supplied prompt. An optional exact model label causes the helper to stop on mismatch, not change the model. Record the returned submission time and model label immediately. If the submission status is uncertain, inspect the current chat and checkpoints before taking further action; never blindly resend.
4. Poll `response()` in short, bounded calls. Stop on `rate_limited`; require two consecutive complete observations with identical nonempty response text and no Stop button. Checkpoint the response immediately.
5. Call `openSources(conversation_url)` to open the response’s ellipsis → View sources menu. If it returns `panel_ready`, persist that baseline before calling `sources(baseline)`. The baseline records the initially visible and hidden counts by section. Resume using the saved baseline if interrupted; if the panel closed, reopen it but retain the original baseline for validation. Do not infer URLs from citation badges.
6. Wait for `sources(baseline)` to return `ready: true`. Validate that the captured counts equal the initial counts plus the displayed expansion counts, and that each entry has a title and HTTP(S) URL. Preserve Sources and More separately; More entries are additional results, not necessarily citations.
7. If the verified menu has no View sources item, use the result from `openSources()`. `no_sources_verified` means there are also no inline links or badges. `no_view_sources_with_inline_links_or_badges` means the panel capture is incomplete; retain inline links and badge counts on the response, not as source-panel entries.
8. Write and read back the JSONL exports before leaving the chat. Audit unique prompt/run IDs, prompt matches, timing, model labels, source counts, and exceptions. Capture validation does not establish factual accuracy.

## Example browser calls

```js
await navigate({url: 'https://chatgpt.com/?temporary-chat=true'});
const verified = await browserjs(() => discoveryChat.prepare());
// Check pacing and persist the submission-pending checkpoint first.
const submitted = await browserjs((p, m) => discoveryChat.submit(p, m), prompt, expectedModel ?? null);
// Persist submitted, then use bounded polls until two complete responses match.
const response = await browserjs(() => discoveryChat.response());
// Persist the stable response before opening the panel.
const baseline = await browserjs(url => discoveryChat.openSources(url), response.conversation_url);
// Persist baseline before expansion; retry bounded capture if it returns pending.
const result = baseline.status === 'panel_ready'
  ? await browserjs(b => discoveryChat.sources(b), baseline)
  : baseline;
```

## Export conventions

- `responses.jsonl.txt`: one record per prompt/run, with `record_id`, `prompt_id`, `run`, `prompt`, `response_text`, `conversation_url`, `captured_at`, `model_label`, personalization evidence, `mentions`, `source_counts` (`main`, `more`), `sources_complete`, and `source_status`. Include `inline_links` and `badge_count` where applicable. First textual mention order is not recommendation rank; report them separately if tracked.
- `sources.jsonl.txt`: one record per source-panel entry, with `record_id`, `section`, `position`, `title`, `url`, `canonical_url`, `site`, and `excerpt`. Preserve exact URLs and repeated entries. Strip known tracking parameters only from the separate `canonical_url` field.
- Recursively sort object keys; preserve array and source order. Use `.txt` backing files because the artifact reader auto-parses `.json`. Keep per-prompt checkpoints and produce a final batch audit.
