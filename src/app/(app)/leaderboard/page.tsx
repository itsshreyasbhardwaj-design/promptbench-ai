import type { Metadata } from 'next';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { PageBody, PageHeader } from '@/components/page-header';
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
import { Tooltip } from '@/components/ui/overlays';
import { SpreadRail } from '@/components/ui/spread-rail';
import { railBounds } from '@/lib/utils/bounds';
import { SyntheticNotice } from '@/components/synthetic-notice';
import { requireSession } from '@/lib/auth/session';
import { loadAnalytics } from '@/lib/services/analytics';
import { formatLatency, formatTokens, formatUsd } from '@/lib/models/cost';

export const metadata: Metadata = {
  title: 'Leaderboard',
  description: 'Every model you have run, ranked by quality, speed and cost.',
};

export const dynamic = 'force-dynamic';

export default async function LeaderboardPage() {
  const session = await requireSession();
  const { leaderboard } = await loadAnalytics(session, { days: 90 });

  if (leaderboard.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Analysis" title="Leaderboard" />
        <PageBody>
          <Panel flush>
            <EmptyState
              icon={<Trophy className="size-5" />}
              title="No models ranked yet"
              description="The leaderboard ranks every model you have actually run, using your prompts rather than a public benchmark."
              action={
                <Button asChild variant="primary" size="sm">
                  <Link href="/playground">Run a comparison</Link>
                </Button>
              }
            />
          </Panel>
        </PageBody>
      </>
    );
  }

  const scoreBounds = railBounds(leaderboard.map((e) => e.avgScore));
  const costBounds = railBounds(leaderboard.map((e) => e.avgCostUsd));
  const latencyBounds = railBounds(leaderboard.map((e) => e.avgLatencyMs));

  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="Leaderboard"
        description="Ranked on your prompts, not a public benchmark. That is the point — a model that tops MMLU may still lose on your actual workload."
      />

      <PageBody className="space-y-5">
        <SyntheticNotice />

        <Panel flush className="overflow-hidden">
          <Table>
            <caption className="sr-only">
              Models ranked by average rubric score, with win rate, latency and cost
            </caption>
            <thead>
              <tr>
                <Th className="w-10">#</Th>
                <Th>Model</Th>
                <Th align="right">Score</Th>
                <Th className="w-32">Spread</Th>
                <Th align="right">Win rate</Th>
                <Th align="right">Avg latency</Th>
                <Th align="right">p95</Th>
                <Th align="right">Avg cost</Th>
                <Th align="right">Value</Th>
                <Th align="right">Runs</Th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((entry, index) => (
                <tr
                  key={entry.modelId}
                  className="hover:bg-surface-raised/50 transition-colors"
                >
                  <Td>
                    <span
                      data-numeric
                      className={
                        index === 0 ? 'text-signal font-semibold' : 'text-ink-faint'
                      }
                    >
                      {entry.rank}
                    </span>
                  </Td>

                  <Td>
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: `var(--color-series-${(index % 8) + 1})`,
                        }}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="text-ink truncate text-[13px] font-medium">
                          {entry.modelName}
                        </p>
                        <p className="text-ink-faint truncate text-[11px]">
                          {entry.providerLabel}
                        </p>
                      </div>
                    </div>
                  </Td>

                  <Td align="right">
                    <Numeric
                      value={entry.avgScore === null ? '—' : entry.avgScore.toFixed(1)}
                      className="text-[13px] font-semibold"
                    />
                  </Td>

                  <Td>
                    <SpreadRail
                      value={entry.avgScore ?? 0}
                      min={scoreBounds.min}
                      max={scoreBounds.max}
                      series={index + 1}
                      label={`${entry.modelName} score`}
                      dense
                    />
                  </Td>

                  <Td align="right">
                    <Numeric
                      value={
                        entry.winRate === null
                          ? '—'
                          : `${(entry.winRate * 100).toFixed(0)}%`
                      }
                      className="text-[13px]"
                      tone={
                        entry.winRate !== null && entry.winRate > 0.5 ? 'good' : 'default'
                      }
                    />
                  </Td>

                  <Td align="right">
                    <div className="flex items-center justify-end gap-2">
                      <Numeric
                        value={formatLatency(entry.avgLatencyMs)}
                        className="text-[13px]"
                      />
                      <div className="hidden w-12 xl:block">
                        <SpreadRail
                          value={entry.avgLatencyMs}
                          min={latencyBounds.min}
                          max={latencyBounds.max}
                          lowerIsBetter
                          series={index + 1}
                          label="latency"
                          dense
                        />
                      </div>
                    </div>
                  </Td>

                  <Td align="right">
                    <Numeric
                      value={formatLatency(entry.p95LatencyMs)}
                      className="text-[13px]"
                      tone="muted"
                    />
                  </Td>

                  <Td align="right">
                    <div className="flex items-center justify-end gap-2">
                      <Numeric
                        value={formatUsd(entry.avgCostUsd)}
                        className="text-[13px]"
                      />
                      <div className="hidden w-12 xl:block">
                        <SpreadRail
                          value={entry.avgCostUsd}
                          min={costBounds.min}
                          max={costBounds.max}
                          lowerIsBetter
                          series={index + 1}
                          label="cost"
                          dense
                        />
                      </div>
                    </div>
                  </Td>

                  <Td align="right">
                    <Tooltip content="Rubric points per cent spent. Higher is better value.">
                      <span className="cursor-help">
                        <Numeric
                          value={
                            entry.valueScore === null ? '—' : entry.valueScore.toFixed(1)
                          }
                          className="text-[13px]"
                          tone="muted"
                        />
                      </span>
                    </Tooltip>
                  </Td>

                  <Td align="right">
                    <Numeric value={entry.runs} className="text-[13px]" tone="muted" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <div className="grid gap-3 md:grid-cols-3">
          {leaderboard.slice(0, 3).map((entry, index) => (
            <Panel key={entry.modelId} className="space-y-3">
              <div className="flex items-center justify-between">
                <Badge tone={index === 0 ? 'signal' : 'neutral'}>Rank {entry.rank}</Badge>
                <Numeric
                  value={formatTokens(entry.avgTokens)}
                  className="text-[11px]"
                  tone="muted"
                />
              </div>
              <div>
                <p className="text-ink text-[14px] font-semibold">{entry.modelName}</p>
                <p className="text-ink-faint text-[11px]">{entry.providerLabel}</p>
              </div>
              {Object.keys(entry.criterionAverages).length > 0 ? (
                <dl className="border-line space-y-1.5 border-t pt-3">
                  {Object.entries(entry.criterionAverages)
                    .slice(0, 4)
                    .map(([criterion, score]) => (
                      <div
                        key={criterion}
                        className="flex items-baseline justify-between gap-2"
                      >
                        <dt className="text-ink-subtle text-[11px] capitalize">
                          {criterion.replace(/_/g, ' ')}
                        </dt>
                        <dd>
                          <Numeric value={score.toFixed(1)} className="text-[11px]" />
                        </dd>
                      </div>
                    ))}
                </dl>
              ) : null}
            </Panel>
          ))}
        </div>
      </PageBody>
    </>
  );
}
