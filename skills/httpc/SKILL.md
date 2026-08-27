---
name: httpc
description: Decide how to call a vendor REST API — and use the right tool for the case. Routes between httpc (preset vendors + backend code), curl, and REPL+requests. Use when an agent needs to make or debug a live vendor API call, or when building backend code that calls vendor APIs.
---

## First: pick the right tool (do this before anything else)

`httpc` is **not** a universal replacement for curl. Route by case so you don't
reach for it uselessly:

| Case | Use | Why |
|---|---|---|
| **One-off call to a generic / arbitrary API** (RunPod, an OpenAI-compatible endpoint, any plain REST) | **`curl`** (or REPL `requests` if you'll loop/chain) | httpc adds nothing here but a longer command line. `curl -sS -D - -H "Authorization: Bearer $KEY" <url>` already gives you status + headers + body. |
| **One-off call to a preset vendor** (Stripe, WorkOS, Slack) | **`httpc`** | It handles the quirks curl can't: Stripe form-encoding, Slack `ok:false` on HTTP 200, 429 → `rate_limit` with `retryAfterMs`. |
| **Multi-step logic in one place** (parse → branch → retry → chain) | **REPL + `requests`** | One kernel, result stays a variable. httpc is a separate process per call; you'd parse stdout each time. |
| **Writing backend code that calls vendors** | **`httpc` reference impl** (port it) | The real value: one entry point, centralized retries + error taxonomy + observability. See "Building backend code" below. |
| **Debugging a vendor failure and you need the wire** | any of the above | curl/requests/httpc all preserve status + headers + raw body. Pick whichever you're already in. |

**Rule of thumb:** if the API isn't Stripe/WorkOS/Slack and you're not writing
backend code, **default to `curl`**. Use `httpc` for the preset vendors and for
the code-porting path. Do not wrap a generic one-off in `httpc --vendor
generic` just because the skill exists.

**Original reference:** <https://x.com/alvinsng/status/2077114275412512868>

---

The rest of this skill is the **httpc** reference — read it when the case above
routes you to httpc (preset vendor, or backend code).

## The binary

`httpc` is already on PATH at `~/.local/bin/httpc` (release build). No setup
needed. The reference implementation (to read or port) lives at
`/Users/trentrobbins/code/prototyping/http-base-client/cli/src/`.

## Why use it

- **The wire is never lost** — every result carries `data`, `status`,
  `statusText`, `headers`, and `rawBody`. When nginx/Cloudflare/a firewall
  returns HTML instead of JSON, you see exactly what came back, including
  `request-id` and `cf-ray` headers to hand to vendor support.
- **One error shape** — a Stripe 429 and a WorkOS 429 are both `rate_limit`
  with `retryAfterMs`. A Slack `ok:false` on HTTP 200 is a `slack` error, not
  a silent success.
- **Centralized retries** — exponential backoff + jitter for 429/5xx in one
  place, instead of one-off retry logic per call site.
- **No SDK bloat** — a narrow endpoint surface instead of a generated package.

## When to use (httpc specifically)

- A **preset vendor** call (Stripe, WorkOS, Slack) — it handles the quirks
  curl can't.
- **Writing backend code** that calls vendors: read
  `/Users/trentrobbins/code/prototyping/http-base-client/cli/src/client.rs`
  and `vendors.rs` as the reference `HttpBaseClient` to port.

## When NOT to use (use curl / requests instead)

- A **generic / arbitrary API** one-off (RunPod, an OpenAI-compatible
  endpoint, plain REST) → **`curl`** or REPL `requests`. httpc adds nothing
  but verbosity here.
- **Multi-step logic** (parse → branch → retry → chain) → REPL `requests`.
- The SDK is the product boundary, not a REST wrapper (e.g. Sentry's runtime
  instrumentation).
- The API is not HTTP (databases, etc.).
- You need pagination, streaming, webhooks, or file uploads (use `raw` or
  extend the surface).

## Usage

### 1. List the narrow surface (do this first)

```bash
httpc endpoints            # or: httpc endpoints --json
```

### 2. Call a vendor endpoint

```bash
httpc --vendor stripe call stripe/customers/create -a email=a@b.com -a name='A B'
httpc --vendor workos call workos/users/list -a organization_id=org_01
httpc --vendor slack call slack/chat.postMessage -a channel=C0123 -a text=hi
```

### 3. Any HTTP API (generic vendor)

> **Read the routing table first.** For a one-off generic call, `curl` is
> usually the better tool — use httpc-generic only when you specifically want
> its retries, consistent output shape, or MCP delivery.

For a vendor not in the presets, use `--vendor generic` with `--base-url` and
`raw`. This is how you call RunPod, or any OpenAI-compatible or plain REST
API. `--api-key` works for generic too (sent as `Authorization: Bearer`):

```bash
# RunPod control plane (v2 REST). NOTE: api.runpod.io is the v2 REST host;
# api.runpod.ai is the v1/invoke host — its /v2/... paths 404.
httpc --vendor generic --base-url https://api.runpod.io/v2 \
  --api-key "$RUNPOD_API_KEY" \
  raw GET /serverless
```

Prefer the vendor's API docs (or `llms.txt` / OpenAPI spec) for the exact
paths — presets only cover the narrow surface, and `raw` is the power path
for everything else.

### 4. See the full wire

```bash
httpc --vendor stripe --raw call stripe/customers/retrieve -a customer_id=cus_123
httpc --vendor stripe --json call stripe/customers/retrieve -a customer_id=cus_123
```

`--raw` prints status, headers, and the raw body. `--json` prints the full
`UpstreamCallResult` object.

### 5. Raw requests (power path)

```bash
httpc --vendor stripe raw GET /v1/customers/cus_123
httpc --vendor workos raw POST /user_management/users --body '{"email":"a@b.com"}'
httpc --vendor generic --base-url https://api.example.com raw GET /v1/things -H 'X-Api-Key: ...'
```

### 6. Retries

```bash
httpc --vendor stripe --max-attempts 5 --base-delay-ms 500 call stripe/customers/create -a ...
```

Retryable by default: 429, 500, 502, 503, 504.

### 7. Local mock (demos and tests)

```bash
httpc mock --port 4567 &
httpc --vendor stripe --base-url http://127.0.0.1:4567 call stripe/customers/create -a email=a@b.com -a name='A B'
httpc --vendor stripe --base-url http://127.0.0.1:4567 --max-attempts 1 raw GET /flaky/nginx-502
```

The mock simulates the vendors AND the failure modes in front of them:
`/flaky/nginx-502`, `/flaky/cloudflare-block`, `/flaky/firewall-429`,
`/flaky/malformed-json`, `/flaky/recover-after-2`.

## MCP

`httpc mcp` serves two stdio tools: `httpc` (narrow endpoint) and
`httpc-raw` (raw request). Both return the full wire result as JSON text.

## Output

Success (default): pretty JSON `data` plus `request-id` when present.
Success (`--raw`): `status:`, `duration:`, `headers:` (indented `key: value`),
then `rawBody:` and the body.
Success (`--json`): the full `UpstreamCallResult` object — `data`, `status`,
`status_text`, `headers`, `raw_body`, `duration_ms`. **`headers` is a list of
`[key, value]` pairs, not an object** — to parse, do
`{k: v for k, v in headers}` (Python) or `Object.fromEntries(headers)` (JS).

Failure: non-zero exit, and the wire detail on stderr:

```text
status:    502 Bad Gateway
content-type: text/html
rawBody:   <!DOCTYPE html>...
error: upstream responded with HTTP 502 Bad Gateway
```

Error variants: `transport` (no HTTP response at all), `http` (non-2xx,
possibly HTML), `rate_limit` (any vendor's 429, with `retryAfterMs`),
`stripe` (vendor `error.type`/`error.code`), `slack` (`ok:false` on 200).

## Building backend code against a vendor

When the task is to write code (not make a live call), do not reach for the
vendor SDK. Port the reference implementation:

- `cli/src/client.rs` — `UpstreamClient`: auth, serialization, transport,
  retries, error translation, duration tracking.
- `cli/src/vendors.rs` — narrow endpoint methods + `dispatch` +
  `endpoint_catalog`.
- `cli/src/models.rs` — the error hierarchy and `UpstreamCallResult`.

Rules: one entry point for all vendor traffic; never throw away the raw
response; one error hierarchy; vendor quirks (Stripe form-encoding, Slack
`ok:false`) live in the vendor layer; unified observability labels
`{dependency, endpoint, method}`.

**Cost:** one small binary and a narrow endpoint surface. **Benefit:** every
vendor call keeps the wire visible, retries in one place, and one error type
to catch.
