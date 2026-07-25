# Architecture

## Design principles

### 1. One gateway, many providers

OpenRouter exposes an OpenAI-compatible API in front of OpenAI, Anthropic,
Google, Groq, DeepSeek, Mistral, Meta, Qwen and Cohere. One adapter therefore
covers all of them, and a single credential unlocks the whole catalog.

Everything vendor-specific — pricing, context windows, capability flags,
release dates — lives in `MODEL_CATALOG` as data. Adding a model is a pure data
change; the picker, cost engine, charts and reports all read from the catalog.

### 2. Every driver has two implementations

| Concern     | Configured           | Default                 |
| ----------- | -------------------- | ----------------------- |
| Models      | OpenRouter           | Deterministic simulator |
| Persistence | Postgres via Drizzle | In-memory repositories  |
| Auth        | Clerk                | Single local identity   |

Both sides of each pair implement the same interface and are held to the same
tests. That is what makes zero-config operation a genuine feature rather than a
degraded mode: the default path is exercised by the entire test suite on every
commit, so it cannot quietly rot.

The simulator is a _simulator_, not a model. It exists so the product is
demonstrable offline, CI is deterministic, and no test can spend money. Its
output is labelled synthetic on every screen and in every export.

### 3. Tenant scoping is structural

Every repository method that reads tenant data takes `workspaceId` as its first
argument:

```ts
findById(workspaceId: string, id: string): Promise<PromptRecord | null>;
```

It is not possible to write a call that forgets to scope by tenant — the
signature will not compile. Cross-tenant isolation is covered explicitly in the
repository conformance suite.

## Request paths

### Streaming comparison

```
Browser                    /api/v1/compare                Providers
   │                              │                            │
   ├── POST {template, models} ──▶│                            │
   │                              ├── auth + permission        │
   │                              ├── rate limit (tighter:     │
   │                              │   this fans out to N calls)│
   │                              ├── validate every model id  │
   │                              │   BEFORE opening the stream│
   │                              │                            │
   │                              ├── spawn one task per model ▶
   │                              │                            │
   │◀── {"type":"start",...}\n ───┤◀── first token (Groq)      │
   │◀── {"type":"delta",...}\n ───┤                            │
   │◀── {"type":"delta",...}\n ───┤◀── first token (GPT-4o)    │
   │◀── {"type":"done",...}\n  ───┤                            │
```

Models are validated before the stream opens so a typo returns a clean 422
rather than a half-written body the client has to unpick.

The response is NDJSON rather than SSE for two reasons: the client is `fetch`
based (`EventSource` cannot POST), and NDJSON needs no frame encoding on either
side. Every event carries its own `modelId`, so one multiplexed stream feeds
every pane and a slow model never blocks a fast one.

On the client, deltas are buffered and flushed once per animation frame. A fast
model emits hundreds of tokens per second across six panes; re-rendering per
token pegs the main thread and the text visibly stutters.

### Benchmark execution

```
executeRun()
   │
   ├── resolve rubric (built-in, custom, or none)
   ├── build cases (inline, or dataset rows → template variables)
   ├── persist run as `running`  ← survives a client disconnect
   │
   ├── runBenchmark()
   │      ├── validate every model id up front
   │      ├── bounded worker pool (6 concurrent)
   │      │     └── per (model, case):
   │      │           complete() → evaluate() → row
   │      │           failures contained to one row
   │      └── summarise() → per-model aggregates, win rates, p95
   │
   ├── persist result rows (chunked at 250)
   └── update run → `succeeded` | `failed`
```

Failures are contained per pair. One model timing out produces an errored row
and a `failures` count in the aggregate — a partial comparison is far more
useful than none.

## Key decisions

**Batched judging.** All judge criteria for one response are scored in a single
model call rather than one call per criterion. That is a 6× cost reduction on
the default rubric, and it also gives the judge the full picture, which reduces
the inconsistency you get from scoring criteria in isolation.

**Confidence-weighted aggregation.** A criterion's rubric weight is scaled by
its scorer's confidence before averaging. A readability heuristic (~0.6) should
not move the headline score as much as a judge verdict (~0.85). Without this,
cheap proxies dominate mixed rubrics.

**Ties count as half a win.** Standard convention for head-to-head rates, and it
avoids penalising models that genuinely tie. Only cases both models scored are
compared, so a model that failed on some cases is neither credited nor punished
for them there — failures surface separately.

**`jsonb` for stable payloads.** Completions, evaluations and aggregates are
written once and read whole. Normalising them would cost a dozen joins on every
result-grid render for no query benefit. Anything actually filtered or sorted on
(`score`, `latencyMs`, `costUsd`, `totalTokens`) is promoted to a real column.

**No headless Chromium for PDF.** The HTML report is self-contained and
print-ready, so "export PDF" is the browser's own print dialog. Bundling
Chromium would add ~300 MB, would not run on most serverless targets, and would
produce a worse result than the print engine already on the user's machine.

**Application-generated prefixed ids.** `prompt_x7k2…` rather than a serial or
bare UUID. An object's type is legible from its id anywhere it appears, which is
worth far more during debugging than the handful of bytes it costs.

**Sliding-window rate limiting.** A fixed window permits a 2× burst across the
boundary — exactly the case that matters when the limited action costs money.
The in-process store is correct for single-node deploys; `setRateLimitStore()`
swaps in Redis for horizontal scaling.

## Known limits

- **In-process rate limiting.** On a horizontally scaled deployment each
  instance keeps its own window, so the effective limit is
  `RATE_LIMIT_REQUESTS × instances`.
- **Synchronous benchmark execution.** `POST /api/v1/benchmarks` returns when
  the run finishes. Right for interactive and scripted use; very large dataset
  sweeps should be chunked by the caller or run behind a queue.
- **In-memory persistence is not durable.** Data resets on restart, and is
  per-instance. Set `DATABASE_URL` for anything you intend to keep.
- **Token estimation is approximate.** Used only for pre-flight projection and
  for the local driver; real usage comes from the provider on every live call.
