<div align="center">

# PromptBench AI

**Stop guessing which model is actually better.**

Run one prompt against every model at once. Watch the responses stream in side by
side, with real latency, token counts and cost measured per call — then score
them against a rubric you control.

[![CI](https://github.com/itsshreyasbhardwaj-design/promptbench-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/itsshreyasbhardwaj-design/promptbench-ai/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](./tsconfig.json)

</div>

> [!NOTE]
> **Runs with zero configuration.** No API key, no database, no signup. A
> deterministic local driver ships in the box, so `pnpm install && pnpm dev`
> gives you the complete product — playground, evaluation, analytics, reports —
> offline and at zero cost. Add credentials only for the capabilities you want.

---

## Screenshots

<!-- Replace these placeholders with real captures before publishing a release. -->

|             Playground              |               Dashboard               |
| :---------------------------------: | :-----------------------------------: |
| _`docs/screenshots/playground.png`_ |  _`docs/screenshots/dashboard.png`_   |
|  Streaming side-by-side comparison  | Cost, latency and quality at a glance |

|             Leaderboard              |             Report              |
| :----------------------------------: | :-----------------------------: |
| _`docs/screenshots/leaderboard.png`_ | _`docs/screenshots/report.png`_ |
|   Models ranked on _your_ prompts    |  Exportable executive summary   |

---

## Why this exists

Public benchmarks tell you how a model does on someone else's tasks. They cannot
tell you whether GPT-4o mini is good enough for _your_ classifier, or whether the
model you are paying 20× more for is actually 20× better on _your_ prompt.

PromptBench answers that question with evidence:

- **Measured, not remembered.** Latency, time-to-first-token, token split and
  cost are recorded per call, not estimated after the fact.
- **Scored against criteria you choose.** Ten criteria, six presets, arbitrary
  weights. An LLM judge for the subjective ones, local heuristics for the cheap ones.
- **Reproducible.** Every run stores the exact template, parameters and model
  versions it used, so a result can be re-examined months later.
- **Honest about uncertainty.** Simulated data is labelled as such on every
  screen and in every export. Cost figures are always described as estimates.

---

## Features

### Prompt playground

Rich editor with `{{variable}}` templating and `{{variable|default}}` fallbacks,
live token estimation, upper-bound cost projection _before_ you spend anything,
and `⌘↵` to run.

### Multi-model comparison

One prompt, up to eight models, streamed concurrently through a single
multiplexed NDJSON response. A fast model shows its answer and its cost while a
slower one is still writing. Each pane reports response, latency, TTFT, token
usage, estimated cost, context window and resolved model version.

### Evaluation engine

| Criterion             | Scorer    | Notes                                     |
| --------------------- | --------- | ----------------------------------------- |
| Correctness           | LLM judge | Factual and logical accuracy only         |
| Helpfulness           | LLM judge | Can a competent user act on this?         |
| Reasoning             | LLM judge | Validity of the chain, not the conclusion |
| Code quality          | LLM judge | Compiles, idiomatic, handles edge cases   |
| Creativity            | LLM judge | Non-obvious _and_ relevant                |
| Hallucination risk    | LLM judge | Inverted — lower risk scores higher       |
| Instruction following | LLM judge | Proportion of explicit constraints met    |
| Safety                | LLM judge | A well-reasoned refusal scores 100        |
| Conciseness           | Heuristic | Lexical density minus filler and padding  |
| Readability           | Heuristic | Flesch reading ease against a target band |

All judge criteria for one response are scored in a **single** model call — a 6×
cost reduction on the default rubric, and more consistent than scoring criteria
in isolation. Six built-in rubrics ship, including a heuristic-only preset that
costs nothing.

### Prompt versioning

Append-only history. Every edit is a new version with a change note; rollback
appends a copy rather than deleting, so the rollback itself is versioned and
reversible. Line-level LCS diff between any two versions.

### Datasets and batch evaluation

CSV, JSON and JSONL. Parsed in the browser first so schema errors surface before
upload, never mid-run. Columns map onto template variables; a column named
`expected` is passed to the judge as ground truth.

### Analytics

Spend, latency, volume and quality over time. Cost and latency by model, token
input/output split, criterion radar, and a leaderboard ranked on _your_ prompts
with win rates, p95 tails and a score-per-dollar value metric.

### Reports

Executive summary, comparison table and every response — exported as Markdown,
HTML, PDF or JSON. The HTML variant is self-contained and print-ready.

### Team features

Workspaces, shared prompt libraries, comments on prompts/benchmarks/runs, and
four roles with a strict permission ordering (viewer → editor → admin → owner).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Next.js App Router                                             │
│                                                                 │
│  app/(app)/*          Server components — dashboard, playground,│
│                       prompts, datasets, runs, analytics        │
│  app/api/v1/*         REST API — validated, authed, rate limited│
└────────────────────────────┬────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌───────────────┐   ┌─────────────────┐   ┌──────────────────┐
│  Providers    │   │   Evaluation    │   │   Persistence    │
│               │   │                 │   │                  │
│ registry.ts   │   │ rubrics         │   │ Repositories     │
│  ├ openrouter │   │ heuristics      │   │  ├ Postgres      │
│  └ local(sim) │   │ judge (batched) │   │  └ In-memory     │
│               │   │ engine          │   │                  │
│ Model catalog │   │ win rates, p95  │   │ Drizzle schema   │
└───────────────┘   └─────────────────┘   └──────────────────┘
        │                    │                    │
        └────────────────────┴────────────────────┘
                             ▼
                   ┌───────────────────┐
                   │ Benchmark runner  │
                   │ bounded worker    │
                   │ pool, per-pair    │
                   │ failure isolation │
                   └───────────────────┘
```

Three principles hold the design together:

1. **One gateway, many providers.** OpenRouter exposes an OpenAI-compatible
   surface in front of all ten vendors, so one adapter covers them all. Vendor
   facts (pricing, context windows, capabilities) live in the catalog as data —
   adding a model is a pure data change.
2. **Every driver has two implementations.** Models resolve to OpenRouter _or_
   the deterministic simulator; repositories resolve to Postgres _or_ memory.
   Both pairs implement the same interface and are held to the same conformance
   tests, which is what makes zero-config operation a real feature rather than a
   degraded mode.
3. **Tenant scoping is structural.** Every repository read takes `workspaceId`
   as its first argument, so it is not _possible_ to write a query that forgets
   to scope by tenant.

See [`docs/architecture.md`](./docs/architecture.md) for detail.

---

## Installation

**Requirements:** Node ≥ 20.11, pnpm ≥ 9.

```bash
git clone https://github.com/itsshreyasbhardwaj-design/promptbench-ai.git
cd promptbench-ai
pnpm install
pnpm dev
```

Open <http://localhost:3000>. That is the whole setup — the app is fully
functional with no further configuration.

---

## Configuration

Every variable is optional. Copy `.env.example` to `.env.local` and set only
what you need.

| Variable                                                 | Default     | Effect                                                                                    |
| -------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`                                     | —           | Routes to **live models**. Without it, the deterministic local driver serves responses.   |
| `DATABASE_URL`                                           | —           | Enables **Postgres persistence**. Without it, data lives in memory and resets on restart. |
| `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | —           | Enables **multi-tenant auth**. Without them, a single local identity is used.             |
| `PROMPTBENCH_DRIVER`                                     | inferred    | Force `local` or `openrouter`. Useful for offline demos and CI.                           |
| `MAX_MODELS_PER_RUN`                                     | `8`         | Ceiling on comparison fan-out.                                                            |
| `MAX_DATASET_ROWS`                                       | `1000`      | Ceiling on batch size.                                                                    |
| `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS`      | `60` / `60` | Sliding-window API limit per identity.                                                    |
| `PROVIDER_TIMEOUT_MS`                                    | `120000`    | Per-request provider timeout.                                                             |

This yields three runtime modes, reported at `/api/v1/health`:

| Mode     | Models    | Storage      | Auth           |
| -------- | --------- | ------------ | -------------- |
| `local`  | Simulated | Memory       | Local identity |
| `hybrid` | **Live**  | Memory       | Local identity |
| `full`   | **Live**  | **Postgres** | **Clerk**      |

### Database setup (optional)

```bash
# Point DATABASE_URL at any Postgres instance, including Supabase.
pnpm db:generate   # generate SQL from the Drizzle schema
pnpm db:migrate    # apply migrations
```

---

## Usage

### Compare models in the UI

1. Open **Playground**.
2. Write a prompt. Use `{{variable}}` for anything that changes per case.
3. Pick models — the picker shows price and context window inline.
4. Check the projected cost, then **Run comparison** (or `⌘↵`).

### Drive it from the API

Create a key under **Settings → API keys**, then:

```bash
curl -X POST http://localhost:3000/api/v1/benchmarks \
  -H "Authorization: Bearer pb_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Triage comparison",
    "template": "Classify the severity of: {{report}}",
    "modelIds": ["openai/gpt-4o-mini", "anthropic/claude-3-5-haiku"],
    "params": { "temperature": 0.3, "maxTokens": 512, "topP": 1 },
    "cases": [{ "variables": { "report": "Checkout returns 500 for all users" } }],
    "evaluate": true,
    "rubricId": "general-quality"
  }'
```

Stream a comparison as NDJSON:

```bash
curl -N -X POST http://localhost:3000/api/v1/compare \
  -H "Content-Type: application/json" \
  -d '{
    "template": "Explain optimistic locking.",
    "systemPrompt": "", "variables": {},
    "modelIds": ["openai/gpt-4o-mini", "groq/llama-3.1-8b-instant"],
    "params": { "temperature": 0.7, "maxTokens": 512, "topP": 1 }
  }'
```

Export a report:

```bash
curl "http://localhost:3000/api/v1/runs/<run_id>/report?format=markdown" > report.md
```

Full endpoint reference: [`docs/api.md`](./docs/api.md).

---

## Development

```bash
pnpm dev            # dev server
pnpm build          # production build
pnpm typecheck      # strict TypeScript, no emit
pnpm lint           # ESLint
pnpm test           # Vitest unit + integration (251 tests)
pnpm test:coverage  # with coverage thresholds
pnpm test:e2e       # Playwright (46 tests, 2 projects)
pnpm verify         # typecheck + lint + test + build
```

### Adding a model

Append an entry to `MODEL_CATALOG` in
[`src/lib/models/catalog.ts`](./src/lib/models/catalog.ts) and bump
`CATALOG_VERSION`. Nothing else changes — the picker, cost engine, charts and
reports all read from the catalog.

### Adding a provider

Implement the `Provider` interface and call `registerProvider()`. See
[`docs/adding-a-provider.md`](./docs/adding-a-provider.md).

---

## Roadmap

- [ ] Queue-backed execution for very large dataset sweeps
- [ ] Redis-backed rate limiting for multi-instance deployments
- [ ] Regression alerts when a prompt version scores below its predecessor
- [ ] Pairwise human preference collection alongside LLM judging
- [ ] Bring-your-own-endpoint provider (vLLM, Ollama, internal proxies)
- [ ] Public shareable report links
- [ ] Real-time collaborative prompt editing
- [ ] GitHub Action for benchmarking prompt changes in CI

---

## Caveats

Worth stating plainly:

- **Cost figures are estimates** from published list pricing at a catalog
  snapshot. They exclude negotiated rates, volume discounts and free tiers.
- **LLM-as-judge is not ground truth.** It is well-established as a useful
  proxy that correlates with human preference, not a replacement for it.
  Confidence is reported alongside every score for exactly this reason.
- **The local driver is a simulator, not a model.** It exists so the product
  works offline and CI is deterministic. Its output is labelled synthetic
  everywhere it appears and must never be cited as a benchmark.
- **In-memory persistence is not durable.** Set `DATABASE_URL` for anything you
  intend to keep.

---

## Contributing

Contributions are welcome. Please read
[CONTRIBUTING.md](./CONTRIBUTING.md) and open an issue before starting
substantial work.

---

## License

[MIT](./LICENSE) © PromptBench AI contributors
