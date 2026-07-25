# Contributing to PromptBench AI

Thanks for considering a contribution. This document covers how to get set up,
what the codebase expects, and how changes get reviewed.

## Getting started

**Requirements:** Node ≥ 20.11, pnpm ≥ 9.

```bash
git clone https://github.com/<your-username>/promptbench-ai.git
cd promptbench-ai
pnpm install
pnpm dev
```

No credentials are needed. The deterministic local driver and in-memory
repositories mean a fresh clone is fully functional offline, which is also what
CI runs against.

## Before you open a pull request

```bash
pnpm verify   # typecheck + lint + test + build
pnpm test:e2e # Playwright, if you touched UI or routes
```

CI runs the same commands. A PR that fails them will not be reviewed until it
passes.

## Project layout

```
src/
├── app/
│   ├── (app)/          Authenticated pages (server components)
│   ├── api/v1/         REST API route handlers
│   └── page.tsx        Landing page
├── components/
│   ├── ui/             Design-system primitives
│   └── app-shell.tsx   Navigation shell
├── features/           Feature-scoped UI (playground, analytics, prompts, …)
└── lib/
    ├── api/            Route wrapper, schemas, rate limiting
    ├── auth/           Sessions, permissions, API keys
    ├── benchmark/      Run orchestration
    ├── core/           Shared types, errors, ids
    ├── datasets/       CSV/JSON/JSONL parsing
    ├── db/             Schema, repositories, drivers
    ├── evaluation/     Rubrics, heuristics, judge, engine
    ├── models/         Catalog and cost accounting
    ├── prompts/        Templating and diffing
    ├── providers/      Provider interface and adapters
    ├── reports/        Report generation
    └── services/       Use cases shared by API and pages
```

## Conventions

### TypeScript

Strict mode with `noUncheckedIndexedAccess` and `noUnusedLocals` on. `any` is an
ESLint error — use `unknown` and narrow. Prefer inference over annotation, and
annotate at module boundaries.

### Comments

Comment the **why**, not the what. A comment that restates the code is noise; a
comment explaining a non-obvious trade-off, a constraint that forced a design, or
a bug the code is guarding against is worth its weight.

```ts
// Good — explains a decision the reader cannot infer.
// SHA-256 rather than a slow KDF specifically because these are 256-bit random
// secrets, not user-chosen passwords: there is no dictionary to attack.

// Bad — restates the code.
// Hash the API key with SHA-256.
```

### Layering

`lib/` must not import from `app/` or `features/`. Client components must not
import modules that transitively reach the database layer — that pulls the
Postgres driver into the browser bundle and breaks the build. If a client
component needs a pure function that lives beside server code, extract it (see
`lib/prompts/diff.ts` and `lib/utils/bounds.ts` for the pattern).

### Adding a model

Append to `MODEL_CATALOG` in `src/lib/models/catalog.ts` and bump
`CATALOG_VERSION`. Pricing must come from the vendor's published list price.
Nothing else needs to change.

### Adding a provider

Implement `Provider` from `src/lib/core/types.ts` and register it. See
[`docs/adding-a-provider.md`](./docs/adding-a-provider.md).

### Adding an API route

Use the `route()` wrapper from `src/lib/api/handler.ts`. It handles auth,
permissions, rate limiting, validation and error shaping in one place — do not
reimplement any of those inline.

```ts
export const POST = route({
  permission: 'prompt:write',
  bodySchema: createPromptSchema,
  status: 201,
  handler: async ({ session, body }) => createPrompt(session, body),
});
```

### Accessibility

Not optional. Every change should keep the app usable via keyboard and screen
reader:

- Interactive elements are real buttons and links, with visible focus.
- Icon-only controls carry an `aria-label`.
- Labels must not swallow supplementary hints into the accessible name.
- Data visualisations need a text equivalent.
- Respect `prefers-reduced-motion`.

## Testing

| Kind        | Location                     | What it covers                                     |
| ----------- | ---------------------------- | -------------------------------------------------- |
| Unit        | `src/**/*.test.ts`           | Pure logic — cost, templating, parsing, evaluation |
| Integration | `src/lib/api/routes.test.ts` | Real route handlers end to end                     |
| E2E         | `e2e/*.spec.ts`              | User journeys in a real browser                    |

Write tests that would fail if the behaviour regressed. A test asserting that a
function returns _something_ is worse than no test, because it implies coverage
that does not exist.

Tests must never call a paid API. The suite forces `PROMPTBENCH_DRIVER=local`.

E2E specs run serially against one shared in-memory workspace. If your test
mutates state, do not assume any particular starting state — create what you
need via the API first.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(playground): add temperature presets
fix(providers): buffer partial SSE frames across chunk boundaries
docs(readme): clarify local-mode limitations
test(evaluation): cover inverted criterion scoring
refactor(db): extract pagination helper
chore(deps): bump drizzle-orm to 0.45.2
```

Scopes match the directory you touched. Keep the subject under ~72 characters
and in the imperative mood.

## Pull requests

1. Branch from `main`.
2. Keep the change focused — one concern per PR.
3. Fill in the PR template, including how you verified the change.
4. Add tests for new behaviour and for any bug you fix.
5. Update docs when you change behaviour a user can observe.

## Reporting bugs

Open an issue with the bug report template. Include your runtime mode (visible
at `/api/v1/health`) — most reports turn on whether live models, Postgres or
Clerk are configured.

## Security

Do not open a public issue for a security vulnerability. See
[SECURITY.md](./SECURITY.md).

## Code of conduct

Be straightforward, be kind, and assume good faith. Critique the code, not the
person.
