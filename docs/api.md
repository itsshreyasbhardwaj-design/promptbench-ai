# REST API v1

Base URL: `{APP_URL}/api/v1`

## Authentication

Three paths, resolved in this order:

1. **API key** — `Authorization: Bearer pb_…`. Create one under
   **Settings → API keys**. Keys act with **editor** permissions: enough to
   manage prompts and run benchmarks, not enough to manage members or mint
   further keys.
2. **Clerk session** — a signed-in browser session, when Clerk is configured.
3. **Local identity** — when Clerk is not configured, all requests resolve to a
   single local user. Intended for self-hosted and development use.

```bash
curl -H "Authorization: Bearer pb_your_key_here" \
  https://your-app.vercel.app/api/v1/prompts
```

`GET /models` and `GET /health` need no authentication.

## Response envelope

Success:

```json
{ "data": {} }
```

Failure:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Request body failed validation.",
    "details": { "modelIds": ["Array must contain at least 1 element(s)"] }
  }
}
```

| Code                    | Status | Meaning                                       |
| ----------------------- | ------ | --------------------------------------------- |
| `bad_request`           | 400    | Malformed request, e.g. invalid JSON          |
| `unauthorized`          | 401    | Missing or invalid credentials                |
| `forbidden`             | 403    | Authenticated, but the role is insufficient   |
| `not_found`             | 404    | No such resource in this workspace            |
| `conflict`              | 409    | Would violate a uniqueness constraint         |
| `payload_too_large`     | 413    | Exceeds a configured size limit               |
| `validation_failed`     | 422    | Failed schema validation — see `details`      |
| `rate_limited`          | 429    | Too many requests                             |
| `provider_error`        | 502    | Upstream model provider failed                |
| `provider_unconfigured` | 503    | Required credentials not set                  |
| `provider_timeout`      | 504    | Provider did not respond in time              |
| `internal_error`        | 500    | Unexpected — details are logged, not returned |

## Rate limiting

Default 60 requests per 60 seconds per identity. Expensive endpoints are tighter:
`/compare` gets a quarter of the budget and `/benchmarks` a tenth, because each
call fans out to `models × cases` provider requests.

Every response carries:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1753440000
```

---

## Endpoints

### `GET /health`

Liveness and configuration probe. Unauthenticated. Reports _which_ capabilities
are enabled, never any credential value.

```json
{
  "status": "ok",
  "version": "0.1.0",
  "mode": "local",
  "capabilities": {
    "liveModels": false,
    "persistentStorage": false,
    "managedAuth": false
  },
  "catalog": { "version": "2026-07-25", "modelCount": 20 }
}
```

### `GET /models`

The model catalog. Unauthenticated.

| Query          | Type            | Description                                 |
| -------------- | --------------- | ------------------------------------------- |
| `provider`     | string          | Filter by provider id                       |
| `search`       | string          | Match name, id or provider label            |
| `judgeCapable` | `true`\|`false` | Only models suitable as an evaluation judge |

### `GET /rubrics`

Built-in rubrics and the full criterion vocabulary. Each rubric reports
`costsMoney` and `judgeCriteriaCount` — the questions you actually have before
picking one.

---

### `GET /prompts`

| Query              | Type            | Description                     |
| ------------------ | --------------- | ------------------------------- |
| `search`           | string          | Match name, description or tags |
| `collection`       | string          | Filter by collection            |
| `tags`             | csv             | Require **every** listed tag    |
| `favorite`         | `true`\|`false` | Favourites only                 |
| `limit` / `offset` | int             | Pagination (max limit 200)      |

Returns `{ items, total, limit, offset }`.

### `POST /prompts`

Creates a prompt and its initial version. Requires `prompt:write`.

```json
{
  "name": "Bug triage classifier",
  "description": "Classifies an incoming issue by severity.",
  "template": "Classify the severity of: {{report}}",
  "systemPrompt": "You are a precise triage assistant.",
  "collection": "Engineering",
  "tags": ["classification", "production"],
  "params": { "temperature": 0.3, "maxTokens": 512, "topP": 1 }
}
```

### `GET` / `PATCH` / `DELETE /prompts/{id}`

`PATCH` updates metadata only — `name`, `description`, `collection`, `tags`,
`favorite`. Changing prompt _content_ means creating a version.

### `GET /prompts/{id}/versions`

Full history, newest first.

### `POST /prompts/{id}/versions`

Appends a version and moves the prompt's current pointer to it.

```json
{
  "template": "Classify the severity of: {{report}}\n\nIf ambiguous, choose the lower severity.",
  "params": { "temperature": 0.2, "maxTokens": 512, "topP": 1 },
  "changeNote": "Bias toward lower severity when ambiguous"
}
```

### `PUT /prompts/{id}/versions`

Rolls back by **appending a copy** of an earlier version. History is never
rewritten, so the rollback is itself versioned and reversible.

```json
{ "versionId": "ver_..." }
```

---

### `POST /compare`

Streams one prompt against many models as **newline-delimited JSON**. Requires
`benchmark:run`.

```json
{
  "template": "Explain {{concept}} in two sentences.",
  "systemPrompt": "",
  "variables": { "concept": "optimistic locking" },
  "modelIds": ["openai/gpt-4o-mini", "groq/llama-3.1-8b-instant"],
  "params": { "temperature": 0.7, "maxTokens": 512, "topP": 1 }
}
```

Response is `application/x-ndjson`, one event per line. Every event carries its
`modelId`, so a single stream feeds every pane:

```jsonl
{"type":"start","modelId":"groq/llama-3.1-8b-instant","provider":"groq"}
{"type":"delta","modelId":"groq/llama-3.1-8b-instant","text":"Optimistic "}
{"type":"delta","modelId":"openai/gpt-4o-mini","text":"Optimistic locking "}
{"type":"done","modelId":"groq/llama-3.1-8b-instant","result":{ }}
{"type":"error","modelId":"openai/gpt-4o-mini","message":"…","retryable":true}
```

A model that fails emits `error` and the others continue — a partial comparison
is still useful.

---

### `POST /benchmarks`

Creates **and executes** a run, returning when it finishes. Requires
`benchmark:run`.

```json
{
  "name": "Triage comparison",
  "template": "Classify the severity of: {{report}}",
  "modelIds": ["openai/gpt-4o-mini", "anthropic/claude-3-5-haiku"],
  "params": { "temperature": 0.3, "maxTokens": 512, "topP": 1 },
  "cases": [
    { "variables": { "report": "Checkout returns 500" }, "expected": "critical" }
  ],
  "evaluate": true,
  "rubricId": "general-quality",
  "judgeModelId": "openai/gpt-4o-mini"
}
```

Supply **either** `cases` **or** `datasetId`, never both. With a dataset, each
row becomes a case and only the columns the template references are threaded
through; a column named `expected`, `answer` or `ground_truth` is passed to the
judge as ground truth.

Instead of `rubricId` you may pass an explicit `criteria` array:

```json
{ "criteria": [{ "id": "correctness", "weight": 2 }, { "id": "safety" }] }
```

The response contains the run with its computed summary — per-model aggregates,
win rates, p95 latency, `winnerModelId` and `bestValueModelId`.

### `GET /benchmarks`

Saved benchmark configurations. Paginated.

### `GET /runs`

Run history, newest first. Filter by `benchmarkId` and `status`.

### `GET /runs/{id}`

A run with its full result rows.

### `DELETE /runs/{id}`

### `GET /runs/{id}/report`

Returns the raw document rather than a JSON envelope, so the URL can be opened
in a browser or piped to a file.

| Query      | Values                               |
| ---------- | ------------------------------------ |
| `format`   | `markdown` (default), `html`, `json` |
| `download` | `1` for an attachment disposition    |

```bash
curl "$APP/api/v1/runs/run_abc/report?format=html&download=1" -o report.html
```

For PDF, open the HTML report and use the browser's print dialog.

---

### `POST /evaluate`

Scores an arbitrary response against a rubric — no benchmark required. Useful
for grading output from an existing pipeline or a production log sample.

```json
{
  "prompt": "Explain eventual consistency.",
  "response": "Eventual consistency guarantees replicas converge once writes stop…",
  "rubricId": "factual-accuracy"
}
```

---

### `GET` / `POST /datasets`

`POST` uploads and parses in one step, so malformed data is rejected at upload
rather than mid-run. Requires `dataset:write`.

```json
{
  "name": "Triage cases",
  "format": "csv",
  "content": "report,expected\nCheckout 500s,critical\nAvatar misaligned,low"
}
```

Returns the dataset plus any non-fatal `warnings` (ragged rows, duplicate
headers, skipped JSONL lines).

### `GET` / `DELETE /datasets/{id}`

---

### `GET` / `POST /keys`

Requires `apikey:read` / `apikey:write` (admin or owner).

`POST` returns the plaintext key **exactly once**. It is stored only as a
SHA-256 hash and cannot be recovered.

### `DELETE /keys/{id}`

Revokes a key. Soft delete — the row is retained with `revokedAt` set so the
audit trail survives, and session resolution rejects any revoked key.

---

### `GET` / `POST /comments`

`GET` requires `targetType` (`prompt` | `benchmark` | `run`) and `targetId`.

---

## Permissions

| Permission                                       | Minimum role |
| ------------------------------------------------ | ------------ |
| `*:read`, `comment:write`                        | viewer       |
| `prompt:write`, `dataset:write`, `benchmark:run` | editor       |
| `member:*`, `apikey:*`, `workspace:update`       | admin        |
| `workspace:delete`                               | owner        |

Roles are strictly ordered: `viewer < editor < admin < owner`.

## Limits

| Limit            | Default       | Variable              |
| ---------------- | ------------- | --------------------- |
| Models per run   | 8             | `MAX_MODELS_PER_RUN`  |
| Dataset rows     | 1000          | `MAX_DATASET_ROWS`    |
| Template length  | 100,000 chars | —                     |
| Dataset upload   | 10 MB         | —                     |
| Provider timeout | 120s          | `PROVIDER_TIMEOUT_MS` |
