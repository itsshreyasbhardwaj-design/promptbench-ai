'use client';

import * as React from 'react';
import { Delta, Numeric } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/overlays';
import { cn } from '@/lib/utils/cn';

/**
 * Headline metric card.
 *
 * Deliberately restrained: one number, one label, one change indicator. The
 * temptation with a dashboard is to put a sparkline in every tile, but four
 * sparklines above four full charts is the same information twice, and it makes
 * neither easy to read.
 */
export function StatCard({
  label,
  value,
  unit,
  delta,
  deltaInverted = false,
  hint,
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  delta?: number | null;
  /** True when a decrease is the good outcome — cost, latency. */
  deltaInverted?: boolean;
  hint?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  const content = (
    <div className={cn('panel p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-ink-subtle text-[11px] font-medium tracking-[0.08em] uppercase">
          {label}
        </p>
        {icon ? <span className="text-ink-faint">{icon}</span> : null}
      </div>

      <div className="mt-2.5 flex items-baseline gap-2">
        <Numeric
          value={value}
          unit={unit}
          className="text-2xl leading-none font-semibold"
        />
        {delta !== undefined ? <Delta value={delta} inverted={deltaInverted} /> : null}
      </div>

      {delta !== undefined && delta !== null ? (
        <p className="text-ink-faint mt-1.5 text-[11px]">vs previous period</p>
      ) : null}
    </div>
  );

  return hint ? <Tooltip content={hint}>{content}</Tooltip> : content;
}
