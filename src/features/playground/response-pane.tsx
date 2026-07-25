'use client';

import * as React from 'react';
import { AlertCircle, Check, Copy, Loader2 } from 'lucide-react';
import { Badge, Numeric } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/overlays';
import { SpreadRail } from '@/components/ui/spread-rail';
import { getModel, PROVIDER_LABELS } from '@/lib/models/catalog';
import { formatLatency, formatTokens, formatUsd } from '@/lib/models/cost';
import type { PaneState } from '@/features/playground/use-comparison';
import { cn } from '@/lib/utils/cn';

/**
 * One model's response.
 *
 * The header carries the facts that make a comparison decidable — latency, time
 * to first token, tokens, cost — and they appear *as they become known* rather
 * than all at once at the end, so a fast model's numbers are readable while a
 * slow one is still writing.
 */
export function ResponsePane({
  pane,
  seriesIndex,
  bounds,
}: {
  pane: PaneState;
  seriesIndex: number;
  /** Shared min/max across all panes, so the rails are comparable. */
  bounds: { latency: { min: number; max: number }; cost: { min: number; max: number } };
}) {
  const model = getModel(pane.modelId);
  const color = `var(--color-series-${((seriesIndex - 1) % 8) + 1})`;

  return (
    <article
      className="panel flex min-h-[320px] flex-col overflow-hidden"
      aria-label={`Response from ${model?.name ?? pane.modelId}`}
    >
      <header className="border-line shrink-0 border-b px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <div className="min-w-0">
              <h3 className="text-ink truncate text-[13px] font-semibold">
                {model?.name ?? pane.modelId}
              </h3>
              <p className="text-ink-faint truncate text-[11px]">
                {model ? PROVIDER_LABELS[model.provider] : 'Unknown provider'}
                {model ? ` · ${model.version}` : ''}
              </p>
            </div>
          </div>

          <StatusChip status={pane.status} />
        </div>

        {pane.result ? (
          <>
            <dl className="mt-3 grid grid-cols-4 gap-2 text-[11px]">
              <Metric label="Latency" value={formatLatency(pane.result.latencyMs)} />
              <Metric
                label="TTFT"
                value={
                  pane.result.timeToFirstTokenMs === null
                    ? '—'
                    : formatLatency(pane.result.timeToFirstTokenMs)
                }
              />
              <Metric
                label="Tokens"
                value={formatTokens(pane.result.usage.totalTokens)}
              />
              <Metric label="Cost" value={formatUsd(pane.result.cost.totalCostUsd)} />
            </dl>

            {/* Where this model sits against the others on speed and spend —
                the comparison, not just the measurement. */}
            <div className="mt-3 space-y-1.5">
              <RailRow
                label="Speed"
                value={pane.result.latencyMs}
                min={bounds.latency.min}
                max={bounds.latency.max}
                series={seriesIndex}
              />
              <RailRow
                label="Cost"
                value={pane.result.cost.totalCostUsd}
                min={bounds.cost.min}
                max={bounds.cost.max}
                series={seriesIndex}
              />
            </div>
          </>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        {pane.status === 'error' ? (
          <div className="border-bad/30 bg-bad/[0.07] flex items-start gap-2.5 rounded-lg border px-3 py-2.5">
            <AlertCircle className="text-bad mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 text-[12px] leading-relaxed">
              <p className="text-ink font-medium">Request failed</p>
              <p className="text-ink-subtle mt-0.5 break-words">{pane.error}</p>
              {pane.retryable ? (
                <p className="text-ink-faint mt-1">This error is usually transient.</p>
              ) : null}
            </div>
          </div>
        ) : pane.content ? (
          <p className="text-ink text-[13px] leading-relaxed whitespace-pre-wrap">
            {pane.content}
            {pane.status === 'streaming' ? (
              <span
                className="animate-pulse-signal bg-signal ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] align-middle"
                aria-hidden
              />
            ) : null}
          </p>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-ink-faint text-[12px]">
              {pane.status === 'pending' ? 'Waiting for the first token…' : 'No output.'}
            </p>
          </div>
        )}
      </div>

      {pane.content && pane.status === 'done' ? (
        <footer className="border-line flex shrink-0 items-center justify-between border-t px-4 py-2">
          <span className="text-ink-faint text-[11px]">
            {pane.result?.finishReason === 'length'
              ? 'Truncated at the token limit'
              : `Finished · ${pane.result?.usage.outputTokens ?? 0} output tokens`}
          </span>
          <CopyButton text={pane.content} />
        </footer>
      ) : null}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-faint truncate text-[10px] tracking-[0.06em] uppercase">
        {label}
      </dt>
      <dd>
        <Numeric value={value} className="text-[12px] font-medium" />
      </dd>
    </div>
  );
}

function RailRow({
  label,
  value,
  min,
  max,
  series,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  series: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-faint w-9 shrink-0 text-[10px] tracking-[0.06em] uppercase">
        {label}
      </span>
      {/* Lower latency and lower cost are both better, so the rail fills from
          the good end. */}
      <SpreadRail
        value={value}
        min={min}
        max={max}
        lowerIsBetter
        series={series}
        label={label}
        dense
      />
    </div>
  );
}

function StatusChip({ status }: { status: PaneState['status'] }) {
  if (status === 'streaming' || status === 'pending') {
    return (
      <Badge tone="signal" className="shrink-0">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        {status === 'pending' ? 'Queued' : 'Streaming'}
      </Badge>
    );
  }
  if (status === 'error') {
    return (
      <Badge tone="bad" className="shrink-0">
        Failed
      </Badge>
    );
  }
  if (status === 'done') {
    return (
      <Badge tone="good" className="shrink-0">
        Done
      </Badge>
    );
  }
  return null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; failing silently is better than an
      // alert for a convenience action.
    }
  }, [text]);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Tooltip content={copied ? 'Copied' : 'Copy response'}>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={copy}
        aria-label="Copy response to clipboard"
      >
        {copied ? <Check className={cn('text-good')} /> : <Copy />}
      </Button>
    </Tooltip>
  );
}
