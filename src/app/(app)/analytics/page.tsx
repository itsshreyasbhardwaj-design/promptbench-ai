import type { Metadata } from 'next';
import Link from 'next/link';
import { BarChart3 } from 'lucide-react';
import { PageBody, PageHeader } from '@/components/page-header';
import { EmptyState, Panel } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/features/analytics/stat-card';
import {
  ChartFrame,
  CriterionRadar,
  ModelBarChart,
  TokenChart,
  TrendChart,
} from '@/features/analytics/charts';
import { SyntheticNotice } from '@/components/synthetic-notice';
import { requireSession } from '@/lib/auth/session';
import { loadAnalytics } from '@/lib/services/analytics';
import { formatTokens, formatUsd } from '@/lib/models/cost';

export const metadata: Metadata = {
  title: 'Analytics',
  description: 'Cost, latency, token usage and quality trends across every model.',
};

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const session = await requireSession();
  const analytics = await loadAnalytics(session, { days: 30 });
  const {
    overview,
    timeSeries,
    costByModel,
    latencyByModel,
    tokensByModel,
    radar,
    radarModels,
  } = analytics;

  if (overview.totalRuns === 0) {
    return (
      <>
        <PageHeader eyebrow="Analysis" title="Analytics" />
        <PageBody>
          <Panel flush>
            <EmptyState
              icon={<BarChart3 className="size-5" />}
              title="Nothing to chart yet"
              description="Analytics are computed from completed runs. Run a comparison and the charts populate immediately."
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

  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="Analytics"
        description="The last 30 days across every model. Cost figures are estimates from published list pricing."
      />

      <PageBody className="space-y-5">
        <SyntheticNotice />

        <section
          aria-label="Key metrics"
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          <StatCard
            label="Completions"
            value={overview.totalRuns.toLocaleString()}
            delta={overview.trend.runs}
          />
          <StatCard
            label="Total spend"
            value={formatUsd(overview.totalCostUsd)}
            delta={overview.trend.cost}
            deltaInverted
          />
          <StatCard label="Tokens" value={formatTokens(overview.totalTokens)} />
          <StatCard
            label="Models"
            value={overview.modelsEvaluated}
            hint="Distinct models with at least one completion in the window."
          />
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <ChartFrame title="Spend" description="Daily cost across all models">
            <TrendChart data={timeSeries} metric="costUsd" />
          </ChartFrame>

          <ChartFrame title="Latency" description="Daily mean response time">
            <TrendChart data={timeSeries} metric="avgLatencyMs" />
          </ChartFrame>

          <ChartFrame title="Volume" description="Completions per day">
            <TrendChart data={timeSeries} metric="runs" />
          </ChartFrame>

          <ChartFrame title="Quality" description="Daily mean rubric score">
            <TrendChart data={timeSeries} metric="avgScore" />
          </ChartFrame>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <ChartFrame
            title="Cost by model"
            description="Total spend per model in the window"
          >
            <ModelBarChart
              data={costByModel}
              dataKey="costUsd"
              format="usd"
              label="Total cost"
              height={Math.max(180, costByModel.length * 34)}
            />
          </ChartFrame>

          <ChartFrame
            title="Latency by model"
            description="Mean response time. Compare against p95 in the leaderboard for tail behaviour."
          >
            <ModelBarChart
              data={latencyByModel}
              dataKey="avgMs"
              format="latency"
              label="Avg latency"
              height={Math.max(180, latencyByModel.length * 34)}
            />
          </ChartFrame>
        </div>

        <ChartFrame
          title="Token usage"
          description="Input and output split — the two are billed at different rates, so the ratio drives cost as much as the total."
        >
          <TokenChart data={tokensByModel} />
        </ChartFrame>

        {radar.length > 0 ? (
          <ChartFrame
            title="Criterion profile"
            description="Where each model is strong and weak. Up to five models by evaluated volume."
          >
            <CriterionRadar data={radar} models={radarModels} />
          </ChartFrame>
        ) : null}
      </PageBody>
    </>
  );
}
