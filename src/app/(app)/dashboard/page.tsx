import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, Coins, FlaskConical, Gauge, Layers, Timer } from 'lucide-react';
import { PageBody, PageHeader } from '@/components/page-header';
import { StatCard } from '@/features/analytics/stat-card';
import {
  Badge,
  EmptyState,
  Numeric,
  Panel,
  Table,
  Td,
  Th,
} from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { SpreadRail } from '@/components/ui/spread-rail';
import { railBounds } from '@/lib/utils/bounds';
import { requireSession } from '@/lib/auth/session';
import { loadAnalytics } from '@/lib/services/analytics';
import { listRuns } from '@/lib/services/benchmarks';
import { formatLatency, formatTokens, formatUsd } from '@/lib/models/cost';
import { TrendChart, ChartFrame } from '@/features/analytics/charts';
import { SyntheticNotice } from '@/components/synthetic-notice';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const session = await requireSession();
  const [analytics, runs] = await Promise.all([
    loadAnalytics(session, { days: 30 }),
    listRuns(session, { limit: 5 }),
  ]);

  const { overview, leaderboard, timeSeries } = analytics;
  const hasData = overview.totalRuns > 0;

  const scoreBounds = railBounds(leaderboard.map((entry) => entry.avgScore));

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Quality, cost and latency across every model you have run in the last 30 days."
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href="/playground">
              <FlaskConical />
              New comparison
            </Link>
          </Button>
        }
      />

      <PageBody className="space-y-6">
        <SyntheticNotice />

        {!hasData ? (
          <Panel flush>
            <EmptyState
              icon={<FlaskConical className="size-5" />}
              title="No completions yet"
              description="Run a prompt against a few models in the playground. Results appear here the moment the first run finishes."
              action={
                <Button asChild variant="primary" size="sm">
                  <Link href="/playground">Open the playground</Link>
                </Button>
              }
            />
          </Panel>
        ) : (
          <>
            {/* A labelled region: screen-reader users can jump straight to the
                headline numbers instead of walking the whole page. */}
            <section
              aria-label="Key metrics"
              className="grid grid-cols-2 gap-3 lg:grid-cols-4"
            >
              <StatCard
                label="Completions"
                value={overview.totalRuns.toLocaleString()}
                delta={overview.trend.runs}
                icon={<Layers className="size-4" />}
              />
              <StatCard
                label="Spend"
                value={formatUsd(overview.totalCostUsd)}
                delta={overview.trend.cost}
                deltaInverted
                icon={<Coins className="size-4" />}
                hint="Estimated from published list pricing. Excludes negotiated discounts."
              />
              <StatCard
                label="Avg latency"
                value={formatLatency(overview.avgLatencyMs)}
                delta={overview.trend.latency}
                deltaInverted
                icon={<Timer className="size-4" />}
              />
              <StatCard
                label="Avg score"
                value={overview.avgScore === null ? '—' : overview.avgScore.toFixed(1)}
                unit={overview.avgScore === null ? undefined : '/100'}
                delta={overview.trend.score}
                icon={<Gauge className="size-4" />}
                hint="Weighted rubric score across all evaluated completions."
              />
            </section>

            <div className="grid gap-4 lg:grid-cols-3">
              <ChartFrame
                title="Spend over time"
                description="Daily cost across all models"
                className="lg:col-span-2"
              >
                <TrendChart data={timeSeries} metric="costUsd" />
              </ChartFrame>

              <Panel className="flex flex-col">
                <h3 className="text-ink text-[13px] font-semibold tracking-tight">
                  Top models
                </h3>
                <p className="text-ink-faint mt-0.5 text-[11px]">
                  Ranked by average rubric score
                </p>

                <ul className="mt-4 flex-1 space-y-3.5">
                  {leaderboard.slice(0, 5).map((entry, index) => (
                    <li key={entry.modelId} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-ink truncate text-[13px] font-medium">
                          {entry.modelName}
                        </span>
                        <Numeric
                          value={
                            entry.avgScore === null ? '—' : entry.avgScore.toFixed(1)
                          }
                          className="shrink-0 text-[13px] font-semibold"
                        />
                      </div>
                      <SpreadRail
                        value={entry.avgScore ?? 0}
                        min={scoreBounds.min}
                        max={scoreBounds.max}
                        series={index + 1}
                        label={`${entry.modelName} score`}
                        dense
                      />
                    </li>
                  ))}
                </ul>

                <Button asChild variant="ghost" size="sm" className="mt-4 w-full">
                  <Link href="/leaderboard">
                    Full leaderboard
                    <ArrowRight />
                  </Link>
                </Button>
              </Panel>
            </div>

            <Panel flush>
              <div className="border-line flex items-center justify-between border-b px-5 py-4">
                <div>
                  <h3 className="text-ink text-[13px] font-semibold tracking-tight">
                    Recent runs
                  </h3>
                  <p className="text-ink-faint mt-0.5 text-[11px]">
                    The last {runs.items.length} benchmark executions
                  </p>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/runs">
                    View all
                    <ArrowRight />
                  </Link>
                </Button>
              </div>

              <Table>
                <thead>
                  <tr>
                    <Th>Prompt</Th>
                    <Th>Status</Th>
                    <Th align="right">Models</Th>
                    <Th align="right">Cases</Th>
                    <Th align="right">Cost</Th>
                    <Th align="right">Tokens</Th>
                    <Th align="right">Avg latency</Th>
                  </tr>
                </thead>
                <tbody>
                  {runs.items.map((run) => (
                    <tr
                      key={run.id}
                      className="hover:bg-surface-raised/50 transition-colors"
                    >
                      <Td className="max-w-xs">
                        <Link
                          href={`/runs/${run.id}`}
                          className="text-ink hover:text-signal block truncate text-[13px] font-medium"
                        >
                          {run.promptTemplate.slice(0, 70).trim() || 'Untitled prompt'}
                        </Link>
                        <span className="text-ink-faint text-[11px]">
                          {new Date(run.createdAt).toLocaleString()}
                        </span>
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            run.status === 'succeeded'
                              ? 'good'
                              : run.status === 'failed'
                                ? 'bad'
                                : 'neutral'
                          }
                        >
                          {run.status}
                        </Badge>
                      </Td>
                      <Td align="right">
                        <Numeric value={run.modelIds.length} className="text-[13px]" />
                      </Td>
                      <Td align="right">
                        <Numeric value={run.caseCount} className="text-[13px]" />
                      </Td>
                      <Td align="right">
                        <Numeric
                          value={formatUsd(run.totalCostUsd)}
                          className="text-[13px]"
                        />
                      </Td>
                      <Td align="right">
                        <Numeric
                          value={formatTokens(run.totalTokens)}
                          className="text-[13px]"
                          tone="muted"
                        />
                      </Td>
                      <Td align="right">
                        <Numeric
                          value={formatLatency(run.avgLatencyMs)}
                          className="text-[13px]"
                          tone="muted"
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          </>
        )}
      </PageBody>
    </>
  );
}
