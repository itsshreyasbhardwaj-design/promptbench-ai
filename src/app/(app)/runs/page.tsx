import type { Metadata } from 'next';
import Link from 'next/link';
import { History } from 'lucide-react';
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
import { requireSession } from '@/lib/auth/session';
import { listRuns } from '@/lib/services/benchmarks';
import { formatLatency, formatTokens, formatUsd } from '@/lib/models/cost';
import { getModel } from '@/lib/models/catalog';

export const metadata: Metadata = {
  title: 'Run history',
  description: 'Every benchmark you have executed.',
};

export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  const session = await requireSession();
  const page = await listRuns(session, { limit: 100 });

  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="Run history"
        description="Every benchmark execution, with the exact prompt and parameters it used — so any result can be reproduced or re-examined later."
      />

      <PageBody>
        {page.items.length === 0 ? (
          <Panel flush>
            <EmptyState
              icon={<History className="size-5" />}
              title="No runs yet"
              description="Runs are recorded automatically whenever you execute a benchmark."
              action={
                <Button asChild variant="primary" size="sm">
                  <Link href="/playground">Run a comparison</Link>
                </Button>
              }
            />
          </Panel>
        ) : (
          <Panel flush className="overflow-hidden">
            <Table>
              <caption className="sr-only">Benchmark run history, newest first</caption>
              <thead>
                <tr>
                  <Th>Run</Th>
                  <Th>Status</Th>
                  <Th>Models</Th>
                  <Th align="right">Cases</Th>
                  <Th align="right">Winner</Th>
                  <Th align="right">Cost</Th>
                  <Th align="right">Tokens</Th>
                  <Th align="right">Avg latency</Th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((run) => {
                  const winner = run.summary?.winnerModelId;
                  return (
                    <tr
                      key={run.id}
                      className="hover:bg-surface-raised/50 transition-colors"
                    >
                      <Td className="max-w-sm">
                        <Link
                          href={`/runs/${run.id}`}
                          className="text-ink hover:text-signal block truncate text-[13px] font-medium"
                        >
                          {run.promptTemplate.slice(0, 80).trim() || 'Untitled prompt'}
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

                      <Td>
                        <div className="flex items-center gap-1">
                          {run.modelIds.slice(0, 4).map((modelId, index) => (
                            <span
                              key={modelId}
                              className="size-2 rounded-full"
                              style={{
                                backgroundColor: `var(--color-series-${(index % 8) + 1})`,
                              }}
                              title={getModel(modelId)?.name ?? modelId}
                            />
                          ))}
                          <span data-numeric className="text-ink-faint ml-1 text-[11px]">
                            {run.modelIds.length}
                          </span>
                        </div>
                      </Td>

                      <Td align="right">
                        <Numeric value={run.caseCount} className="text-[13px]" />
                      </Td>

                      <Td align="right">
                        <span className="text-ink-muted text-[12px]">
                          {winner ? (getModel(winner)?.name ?? winner) : '—'}
                        </span>
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
                  );
                })}
              </tbody>
            </Table>
          </Panel>
        )}
      </PageBody>
    </>
  );
}
