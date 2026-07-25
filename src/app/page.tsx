import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Numeric } from '@/components/ui/primitives';
import { MODEL_CATALOG, listProviders, PROVIDER_LABELS } from '@/lib/models/catalog';
import { ALL_CRITERION_IDS } from '@/lib/evaluation/rubrics';

export const metadata: Metadata = {
  title: 'PromptBench AI — LLM evaluation and benchmarking',
  description:
    'Compare language models side by side on the same prompt. Measure quality, ' +
    'cost and latency, version your prompts, and export the evidence.',
};

const REPO_URL = 'https://github.com/itsshreyasbhardwaj-design/promptbench-ai';

/**
 * Landing page.
 *
 * The hero is a live rendering of the actual comparison surface rather than a
 * claim about it — the product's whole thesis is that side-by-side measurement
 * beats intuition, so the page opens by doing that instead of describing it.
 */
export default function LandingPage() {
  const providers = listProviders();

  return (
    <div className="bg-canvas min-h-dvh">
      <header className="glass sticky top-0 z-40 border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <Mark />
            <span className="text-ink text-[14px] font-semibold tracking-tight">
              PromptBench
            </span>
            <Badge tone="neutral" className="hidden sm:inline-flex">
              MIT
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
                <Github />
                <span className="hidden sm:inline">GitHub</span>
              </a>
            </Button>
            <Button asChild variant="primary" size="sm">
              <Link href="/dashboard">
                Open app
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="graph-paper border-line relative overflow-hidden border-b">
          <div className="mx-auto max-w-6xl px-5 py-20 md:py-28">
            <div className="max-w-2xl">
              <p className="eyebrow mb-4">Open-source LLM evaluation</p>
              <h1 className="text-ink text-4xl leading-[1.08] font-semibold tracking-[-0.03em] md:text-[56px]">
                Stop guessing which model
                <br />
                <span className="text-signal">is actually better.</span>
              </h1>
              <p className="text-ink-muted mt-6 max-w-xl text-[15px] leading-relaxed md:text-base">
                Run one prompt against every model at once. Watch the responses stream in
                side by side, with real latency, token counts and cost measured per call —
                then score them against a rubric you control.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild variant="primary" size="lg">
                  <Link href="/playground">
                    Try the playground
                    <ArrowRight />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
                    <Github />
                    Star on GitHub
                  </a>
                </Button>
              </div>

              <p className="text-ink-faint mt-5 text-[13px]">
                Runs with zero configuration. No API key, no database, no signup — a
                deterministic local driver ships in the box.
              </p>
            </div>

            {/* The hero itself: a static rendering of the comparison surface. */}
            <div className="mt-14 md:mt-16">
              <ComparisonPreview />
            </div>
          </div>
        </section>

        <section className="border-line border-b">
          <div className="mx-auto max-w-6xl px-5 py-14">
            <div className="grid gap-8 md:grid-cols-4">
              <Stat
                value={String(MODEL_CATALOG.length)}
                label="Models"
                detail={`Across ${providers.length} providers`}
              />
              <Stat
                value={String(ALL_CRITERION_IDS.length)}
                label="Scoring criteria"
                detail="Composable into custom rubrics"
              />
              <Stat value="3" label="Dataset formats" detail="CSV, JSON, JSONL" />
              <Stat value="4" label="Export formats" detail="Markdown, HTML, PDF, JSON" />
            </div>

            <div className="border-line mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-8">
              <span className="text-ink-faint text-[11px] tracking-[0.1em] uppercase">
                Providers
              </span>
              {providers.map((id) => (
                <span key={id} className="text-ink-subtle text-[13px]">
                  {PROVIDER_LABELS[id]}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="border-line border-b">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="max-w-2xl">
              <p className="eyebrow mb-3">What it does</p>
              <h2 className="text-ink text-2xl font-semibold tracking-tight md:text-3xl">
                Everything you need to make a defensible model choice.
              </h2>
            </div>

            <div className="mt-12 grid gap-x-10 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
              <Feature
                title="Streaming comparison"
                body="Every model answers the same prompt at once, in its own pane. Latency, time to first token, tokens and cost land as each one finishes."
              />
              <Feature
                title="Configurable rubrics"
                body="Score on correctness, reasoning, code quality, hallucination risk, safety and more. Weight the criteria yourself, or use one of six presets."
              />
              <Feature
                title="Prompt versioning"
                body="Every edit is a new version with a change note. Diff any two, and roll back by appending — history is never rewritten."
              />
              <Feature
                title="Batch evaluation"
                body="Upload a CSV, JSON or JSONL dataset and run the whole thing. One case tells you about one case; a dataset tells you about production."
              />
              <Feature
                title="Cost and latency analytics"
                body="Spend by model, p95 tails, token splits and quality trends over time — so the cheapest model that is still good enough is obvious."
              />
              <Feature
                title="Reports you can send"
                body="Executive summary, comparison table and every response, exported as Markdown, HTML, PDF or JSON."
              />
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="panel overflow-hidden p-8 md:p-12">
              <div className="max-w-xl">
                <h2 className="text-ink text-2xl font-semibold tracking-tight">
                  Clone it and run it in a minute.
                </h2>
                <p className="text-ink-muted mt-3 text-[15px] leading-relaxed">
                  No credentials required. The local driver gives you a fully working
                  product offline; add an OpenRouter key when you want real models.
                </p>
              </div>

              <pre className="border-line bg-canvas text-ink-muted mt-7 overflow-x-auto rounded-lg border px-4 py-3.5 font-mono text-[12px] leading-relaxed">
                {`git clone ${REPO_URL}.git
cd promptbench-ai
pnpm install
pnpm dev`}
              </pre>

              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild variant="primary">
                  <Link href="/dashboard">
                    Open the app
                    <ArrowRight />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
                    Read the docs
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-line border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8">
          <p className="text-ink-faint text-[12px]">
            MIT licensed. Cost figures are estimates from published list pricing.
          </p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink-subtle hover:text-ink text-[12px] transition-colors"
          >
            Contribute on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

/**
 * Static rendering of the comparison grid. Uses representative figures rather
 * than a live run — it is a screenshot in markup, and labelled as illustrative.
 */
function ComparisonPreview() {
  const panes = [
    {
      model: 'GPT-4o mini',
      provider: 'OpenAI',
      latency: '1.24s',
      cost: '$0.00041',
      score: '84.2',
      width: '92%',
    },
    {
      model: 'Claude 3.5 Haiku',
      provider: 'Anthropic',
      latency: '1.61s',
      cost: '$0.00119',
      score: '81.7',
      width: '78%',
    },
    {
      model: 'Gemini 2.5 Flash',
      provider: 'Google',
      latency: '0.88s',
      cost: '$0.00052',
      score: '79.4',
      width: '64%',
    },
  ];

  return (
    <div className="panel overflow-hidden p-1.5">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-ink-faint font-mono text-[11px]">
          “Classify this issue by severity and propose an owner.”
        </span>
        <Badge tone="neutral">illustrative</Badge>
      </div>

      <div className="grid gap-1.5 md:grid-cols-3">
        {panes.map((pane, index) => (
          <div key={pane.model} className="border-line bg-canvas rounded-lg border p-3.5">
            <div className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: `var(--color-series-${index + 1})` }}
                aria-hidden
              />
              <span className="text-ink text-[12px] font-medium">{pane.model}</span>
            </div>
            <p className="text-ink-faint mt-0.5 text-[11px]">{pane.provider}</p>

            <dl className="mt-3 grid grid-cols-3 gap-2">
              <Cell label="Latency" value={pane.latency} />
              <Cell label="Cost" value={pane.cost} />
              <Cell label="Score" value={pane.score} />
            </dl>

            <div className="bg-surface-raised mt-3 h-1.5 overflow-hidden rounded-full">
              <div
                className="h-full rounded-full"
                style={{
                  width: pane.width,
                  backgroundColor: `var(--color-series-${index + 1})`,
                  opacity: 0.55,
                }}
              />
            </div>

            <div className="mt-3 space-y-1.5" aria-hidden>
              <div className="bg-surface-raised h-1.5 w-full rounded-full" />
              <div className="bg-surface-raised h-1.5 w-[88%] rounded-full" />
              <div className="bg-surface-raised h-1.5 w-[94%] rounded-full" />
              <div className="bg-surface-raised h-1.5 w-[62%] rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-faint truncate text-[9px] tracking-[0.06em] uppercase">
        {label}
      </dt>
      <dd>
        <Numeric value={value} className="text-[11px] font-medium" />
      </dd>
    </div>
  );
}

function Stat({
  value,
  label,
  detail,
}: {
  value: string;
  label: string;
  detail: string;
}) {
  return (
    <div>
      <Numeric value={value} className="text-3xl font-semibold" />
      <p className="text-ink mt-1 text-[13px] font-medium">{label}</p>
      <p className="text-ink-faint mt-0.5 text-[12px]">{detail}</p>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-ink text-[15px] font-semibold tracking-tight">{title}</h3>
      <p className="text-ink-subtle mt-2 text-[13px] leading-relaxed">{body}</p>
    </div>
  );
}

/**
 * GitHub mark. Inlined because lucide-react dropped brand glyphs in v1, and a
 * brand mark should be the official path rather than an approximation.
 */
function Github({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="9.25"
        stroke="var(--color-line-strong)"
        strokeWidth="1.5"
      />
      <path
        d="M12 3.5V7"
        stroke="var(--color-signal)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M12 17v3.5"
        stroke="var(--color-ink-faint)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M3.5 12H7"
        stroke="var(--color-ink-faint)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M17 12h3.5"
        stroke="var(--color-ink-faint)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M8.5 14.5L12 8l3.5 6.5"
        stroke="var(--color-signal)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
