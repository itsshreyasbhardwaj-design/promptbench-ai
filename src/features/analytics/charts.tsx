'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatLatency, formatTokens, formatUsd } from '@/lib/models/cost';
import type { AnalyticsSnapshot } from '@/lib/services/analytics';
import { getModel } from '@/lib/models/catalog';
import { cn } from '@/lib/utils/cn';

/**
 * Chart components.
 *
 * All charts share one axis treatment, one tooltip, and the series colour ramp
 * from the design tokens, so a model keeps the same colour across every
 * visualisation on the page. Colour is the primary key here — if the same model
 * were teal in one chart and amber in the next, cross-referencing them would
 * require reading every legend.
 */

const AXIS = {
  stroke: 'var(--color-ink-faint)',
  fontSize: 11,
  fontFamily: 'var(--font-jetbrains-mono)',
} as const;

const GRID_STROKE = 'var(--color-line)';

function seriesColor(index: number): string {
  return `var(--color-series-${(index % 8) + 1})`;
}

/** Shared tooltip so every chart reads identically. */
function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string | number;
  format?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="glass rounded-lg border px-3 py-2 shadow-xl">
      {label !== undefined ? (
        <p className="text-ink-muted mb-1.5 text-[11px] font-medium">{label}</p>
      ) : null}
      <ul className="space-y-1">
        {payload.map((entry, index) => (
          <li key={index} className="flex items-center gap-2 text-xs">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden
            />
            <span className="text-ink-subtle">{entry.name}</span>
            <span data-numeric className="text-ink ml-auto font-medium">
              {typeof entry.value === 'number' && format
                ? format(entry.value)
                : String(entry.value ?? '—')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartFrame({
  title,
  description,
  children,
  className,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={cn('panel p-5', className)}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-ink text-[13px] font-semibold tracking-tight">{title}</h3>
          {description ? (
            <p className="text-ink-faint mt-0.5 text-[11px]">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ── Trend over time ─────────────────────────────────────────────────────────

export function TrendChart({
  data,
  metric,
}: {
  data: AnalyticsSnapshot['timeSeries'];
  metric: 'costUsd' | 'runs' | 'avgLatencyMs' | 'avgScore';
}) {
  const config = {
    costUsd: { label: 'Spend', format: formatUsd, color: 'var(--color-series-1)' },
    runs: {
      label: 'Completions',
      format: (v: number) => String(v),
      color: 'var(--color-series-2)',
    },
    avgLatencyMs: {
      label: 'Avg latency',
      format: formatLatency,
      color: 'var(--color-series-3)',
    },
    avgScore: {
      label: 'Avg score',
      format: (v: number) => v.toFixed(1),
      color: 'var(--color-series-4)',
    },
  }[metric];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={config.color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={config.color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          {...AXIS}
          tickLine={false}
          axisLine={false}
          // Dates are dense on a 30-day window; show every fifth label.
          interval={Math.max(0, Math.floor(data.length / 6) - 1)}
          tickFormatter={(value: string) => value.slice(5)}
        />
        <YAxis {...AXIS} tickLine={false} axisLine={false} width={52} />
        <RechartsTooltip
          content={<ChartTooltip format={config.format} />}
          cursor={{ stroke: 'var(--color-line-strong)', strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey={metric}
          name={config.label}
          stroke={config.color}
          strokeWidth={2}
          fill={`url(#fill-${metric})`}
          // Dots on a 30-point series are visual noise; keep them on hover only.
          dot={false}
          activeDot={{ r: 3.5, strokeWidth: 0 }}
          connectNulls
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Per-model bars ──────────────────────────────────────────────────────────

/**
 * Named formatters.
 *
 * Charts take a formatter *key* rather than a function because these components
 * are rendered from server components, and functions cannot cross the
 * server/client boundary — React rejects them outright. Resolving the key here
 * keeps the call sites declarative and serialisable.
 */
export type FormatKey = 'usd' | 'latency' | 'tokens' | 'count' | 'score';

const FORMATTERS: Record<FormatKey, (value: number) => string> = {
  usd: formatUsd,
  latency: formatLatency,
  tokens: formatTokens,
  count: (v) => v.toLocaleString(),
  score: (v) => v.toFixed(1),
};

export function ModelBarChart({
  data,
  dataKey,
  format,
  label,
  height = 220,
}: {
  data: Array<{ modelId: string; modelName: string } & Record<string, string | number>>;
  dataKey: string;
  format: FormatKey;
  label: string;
  height?: number;
}) {
  const formatValue = FORMATTERS[format];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          {...AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatValue}
        />
        <YAxis
          type="category"
          dataKey="modelName"
          {...AXIS}
          tickLine={false}
          axisLine={false}
          width={120}
        />
        <RechartsTooltip
          content={<ChartTooltip format={formatValue} />}
          cursor={{ fill: 'var(--color-surface-raised)' }}
        />
        <Bar dataKey={dataKey} name={label} radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((entry, index) => (
            <Cell key={entry.modelId} fill={seriesColor(index)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Token split ─────────────────────────────────────────────────────────────

export function TokenChart({ data }: { data: AnalyticsSnapshot['tokensByModel'] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="modelName"
          {...AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: string) => value.split(' ')[0] ?? value}
        />
        <YAxis
          {...AXIS}
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={formatTokens}
        />
        <RechartsTooltip
          content={<ChartTooltip format={formatTokens} />}
          cursor={{ fill: 'var(--color-surface-raised)' }}
        />
        <Legend
          iconType="circle"
          iconSize={7}
          wrapperStyle={{ fontSize: 11, color: 'var(--color-ink-subtle)', paddingTop: 8 }}
        />
        {/* Stacked because input and output tokens are billed at different
            rates — the split is what explains an unexpected bill. */}
        <Bar
          dataKey="input"
          name="Input"
          stackId="tokens"
          fill="var(--color-series-2)"
          radius={[0, 0, 0, 0]}
          maxBarSize={40}
        />
        <Bar
          dataKey="output"
          name="Output"
          stackId="tokens"
          fill="var(--color-series-1)"
          radius={[4, 4, 0, 0]}
          maxBarSize={40}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Radar ───────────────────────────────────────────────────────────────────

export function CriterionRadar({
  data,
  models,
}: {
  data: AnalyticsSnapshot['radar'];
  models: string[];
}) {
  if (data.length < 3) {
    // A radar with fewer than three axes is a line or a point — misleading as
    // a shape, so fall back rather than render something unreadable.
    return (
      <p className="text-ink-faint py-12 text-center text-[13px]">
        Radar comparison needs at least three scored criteria. Run an evaluation with a
        fuller rubric to populate this.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke={GRID_STROKE} />
        <PolarAngleAxis
          dataKey="label"
          tick={{ fill: 'var(--color-ink-subtle)', fontSize: 11 }}
        />
        <PolarRadiusAxis
          domain={[0, 100]}
          tick={{ fill: 'var(--color-ink-faint)', fontSize: 10 }}
          axisLine={false}
        />
        <RechartsTooltip content={<ChartTooltip format={(v) => v.toFixed(1)} />} />
        <Legend
          iconType="circle"
          iconSize={7}
          wrapperStyle={{ fontSize: 11, color: 'var(--color-ink-subtle)', paddingTop: 4 }}
        />
        {models.map((modelId, index) => (
          <Radar
            key={modelId}
            name={getModel(modelId)?.name ?? modelId}
            dataKey={modelId}
            stroke={seriesColor(index)}
            fill={seriesColor(index)}
            fillOpacity={0.14}
            strokeWidth={2}
          />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  );
}
