import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/page-header';
import {
  Badge,
  Numeric,
  Panel,
  PanelHeader,
  Table,
  Td,
  Th,
} from '@/components/ui/primitives';
import { SpreadRail } from '@/components/ui/spread-rail';
import { railBounds } from '@/lib/utils/bounds';
import { SyntheticNotice } from '@/components/synthetic-notice';
import { ReportExport } from '@/features/runs/report-export';
import { requireSession } from '@/lib/auth/session';
import { getRun } from '@/lib/services/benchmarks';
import { isAppError } from '@/lib/core/errors';
import { formatLatency, formatTokens, formatUsd } from '@/lib/models/cost';
import { getModel } from '@/lib/models/catalog';
import { buildRecommendations } from '@/lib/reports/generate';

export const metadata: Metadata = { title: 'Run' };
export const dynamic = 'force-dynamic';

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  let data;
  try {
    data = await getRun(session, id);
  } catch (error) {
    if (isAppError(error) && error.code === 'not_found') notFound();
    throw error;
  }

  const { run, results } = data;
  const summary = run.summary;
  const recommendations = summary ? buildRecommendations(summary) : [];

  const scoreBounds = railBounds(summary?.models.map((m) => m.avgScore) ?? []);

  // Group results by case so responses can be read side by side per input.
  const byCase = new Map<number, typeof results>();
  for (const result of results) {
    const list = byCase.get(result.caseIndex) ?? [];
    list.push(result);
    byCase.set(result.caseIndex, list);
  }

  return (
    <>
      <PageHeader
        eyebrow={`Run · ${run.status}`}
        title={run.promptTemplate.slice(0, 70).trim() || 'Untitled run'}
        description={`${run.modelIds.length} models × ${run.caseCount} case${
          run.caseCount === 1 ? '' : 's'
        } · ${new Date(run.createdAt).toLocaleString()}`}
        actions={<ReportExport runId={run.id} />}
      />

      <PageBody className="space-y-5">
        <SyntheticNotice />

        {run.errorMessage ? (
          <div className="border-bad/30 bg-bad/[0.07] text-ink rounded-lg border px-4 py-3 text-[13px]">
            <p className="font-medium">This run failed</p>
            <p className="text-ink-subtle mt-0.5">{run.errorMessage}</p>
          </div>
        ) : null}

        {recommendations.length > 0 ? (
          <Panel className="space-y-3">
            <PanelHeader
              title="What the numbers say"
              description="Derived from this run's results."
            />
            <ul className="space-y-2.5">
              {recommendations.map((rec, index) => (
                <li key={index} className="flex gap-2.5 text-[13px] leading-relaxed">
                  <span
                    className="bg-signal mt-[7px] size-1.5 shrink-0 rounded-full"
                    aria-hidden
                  />
                  <span>
                    <strong className="text-ink font-semibold">{rec.headline}.</strong>{' '}
                    <span className="text-ink-subtle">{rec.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {summary && summary.models.length > 0 ? (
          <Panel flush className="overflow-hidden">
            <div className="border-line border-b px-5 py-4">
              <PanelHeader
                title="Model comparison"
                description={`${formatUsd(summary.totalCostUsd)} total · ${formatTokens(
                  summary.totalTokens,
                )} tokens · ${formatLatency(summary.avgLatencyMs)} mean latency`}
              />
            </div>

            <Table>
              <thead>
                <tr>
                  <Th>Model</Th>
                  <Th align="right">Score</Th>
                  <Th className="w-28">Spread</Th>
                  <Th align="right">Win rate</Th>
                  <Th align="right">Avg latency</Th>
                  <Th align="right">p95</Th>
                  <Th align="right">Tokens</Th>
                  <Th align="right">Cost</Th>
                  <Th align="right">Fails</Th>
                </tr>
              </thead>
              <tbody>
                {summary.models.map((model, index) => (
                  <tr
                    key={model.modelId}
                    className="hover:bg-surface-raised/50 transition-colors"
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: `var(--color-series-${(index % 8) + 1})`,
                          }}
                          aria-hidden
                        />
                        <span className="text-ink text-[13px] font-medium">
                          {getModel(model.modelId)?.name ?? model.modelId}
                        </span>
                        {model.modelId === summary.winnerModelId ? (
                          <Badge tone="signal">winner</Badge>
                        ) : null}
                        {model.modelId === summary.bestValueModelId ? (
                          <Badge tone="good">best value</Badge>
                        ) : null}
                      </div>
                    </Td>
                    <Td align="right">
                      <Numeric
                        value={model.avgScore === null ? '—' : model.avgScore.toFixed(1)}
                        className="text-[13px] font-semibold"
                      />
                    </Td>
                    <Td>
                      <SpreadRail
                        value={model.avgScore ?? 0}
                        min={scoreBounds.min}
                        max={scoreBounds.max}
                        series={index + 1}
                        label="score"
                        dense
                      />
                    </Td>
                    <Td align="right">
                      <Numeric
                        value={
                          model.winRate === null
                            ? '—'
                            : `${(model.winRate * 100).toFixed(0)}%`
                        }
                        className="text-[13px]"
                      />
                    </Td>
                    <Td align="right">
                      <Numeric
                        value={formatLatency(model.avgLatencyMs)}
                        className="text-[13px]"
                      />
                    </Td>
                    <Td align="right">
                      <Numeric
                        value={formatLatency(model.p95LatencyMs)}
                        className="text-[13px]"
                        tone="muted"
                      />
                    </Td>
                    <Td align="right">
                      <Numeric
                        value={formatTokens(model.totalTokens)}
                        className="text-[13px]"
                        tone="muted"
                      />
                    </Td>
                    <Td align="right">
                      <Numeric
                        value={formatUsd(model.totalCostUsd)}
                        className="text-[13px]"
                      />
                    </Td>
                    <Td align="right">
                      <Numeric
                        value={model.failures}
                        className="text-[13px]"
                        tone={model.failures > 0 ? 'bad' : 'muted'}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-ink text-[15px] font-semibold tracking-tight">Responses</h2>

          {[...byCase.entries()].map(([caseIndex, rows]) => (
            <Panel key={caseIndex} className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="eyebrow">Case {caseIndex + 1}</p>
                {Object.entries(rows[0]?.variables ?? {}).map(([key, value]) => (
                  <span key={key} className="text-ink-faint text-[11px]">
                    <code className="text-ink-subtle font-mono">{key}</code>:{' '}
                    {value.slice(0, 90)}
                    {value.length > 90 ? '…' : ''}
                  </span>
                ))}
              </div>

              <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="border-line bg-canvas rounded-lg border p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink truncate text-[12px] font-medium">
                        {getModel(row.modelId)?.name ?? row.modelId}
                      </span>
                      {row.score !== null ? (
                        <Numeric
                          value={row.score.toFixed(1)}
                          className="shrink-0 text-[12px] font-semibold"
                        />
                      ) : null}
                    </div>

                    <div className="text-ink-faint mt-1 flex gap-3 text-[11px]">
                      <Numeric value={formatLatency(row.latencyMs)} tone="muted" />
                      <Numeric value={formatUsd(row.costUsd)} tone="muted" />
                      <Numeric value={formatTokens(row.totalTokens)} tone="muted" />
                    </div>

                    <p className="border-line text-ink-muted mt-2.5 line-clamp-[12] border-t pt-2.5 text-[12px] leading-relaxed whitespace-pre-wrap">
                      {row.completion.error
                        ? `Error: ${row.completion.error}`
                        : row.completion.content}
                    </p>

                    {row.evaluation ? (
                      <dl className="border-line mt-3 space-y-1 border-t pt-2.5">
                        {row.evaluation.criteria.slice(0, 4).map((criterion) => (
                          <div
                            key={criterion.criterionId}
                            className="flex items-baseline justify-between gap-2"
                          >
                            <dt className="text-ink-faint text-[10px] capitalize">
                              {criterion.criterionId.replace(/_/g, ' ')}
                            </dt>
                            <dd>
                              <Numeric
                                value={criterion.score.toFixed(0)}
                                className="text-[10px]"
                                tone="muted"
                              />
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </div>
                ))}
              </div>
            </Panel>
          ))}
        </section>
      </PageBody>
    </>
  );
}
