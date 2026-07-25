'use client';

import { cn } from '@/lib/utils/cn';

/**
 * Spread rail — the signature component.
 *
 * A benchmark's insight is never a single number; it is where a model sits
 * relative to the others. This renders exactly that: a normalised axis spanning
 * the observed min and max, with a marker for this model and a hairline for the
 * best value in the set.
 *
 * It is a data encoding, not decoration. When there is only one model, or every
 * model ties, the rail collapses to a flat state and says so — because in that
 * case the spread genuinely carries no information, and drawing a full bar
 * would imply a difference that does not exist.
 */

export interface SpreadRailProps {
  /** This model's value on the axis. */
  value: number;
  /** Lowest value observed across the comparison set. */
  min: number;
  /** Highest value observed across the comparison set. */
  max: number;
  /** When true a lower value is better — latency, cost, hallucination risk. */
  lowerIsBetter?: boolean;
  /** Series colour index 1-8, matching the chart ramp. */
  series?: number;
  label?: string;
  className?: string;
  /** Compact variant used inside dense table rows. */
  dense?: boolean;
}

export function SpreadRail({
  value,
  min,
  max,
  lowerIsBetter = false,
  series = 1,
  label,
  className,
  dense = false,
}: SpreadRailProps) {
  const range = max - min;
  const degenerate = range <= 0 || !Number.isFinite(range);

  // Position along the rail, 0-100. A degenerate range centres the marker
  // rather than dividing by zero.
  const position = degenerate ? 50 : ((value - min) / range) * 100;

  // The best end of the axis depends on the metric's direction.
  const bestPosition = lowerIsBetter ? 0 : 100;
  const isBest = !degenerate && Math.abs(position - bestPosition) < 0.5;

  const color = `var(--color-series-${((series - 1) % 8) + 1})`;

  return (
    <div
      className={cn('flex w-full items-center gap-2', className)}
      role="img"
      aria-label={
        degenerate
          ? `${label ?? 'Value'}: ${value} (no spread across the comparison set)`
          : `${label ?? 'Value'}: ${value}, ${Math.round(position)}% along the range ${min} to ${max}`
      }
    >
      <div
        className={cn(
          'bg-surface-raised relative flex-1 overflow-hidden rounded-full',
          dense ? 'h-1.5' : 'h-2',
        )}
      >
        {degenerate ? (
          <div className="bg-line absolute inset-0" />
        ) : (
          <>
            {/* Filled portion from the worst end up to this model. */}
            <div
              className="absolute inset-y-0 rounded-full transition-[width,left] duration-500 ease-[var(--ease-out-quint)]"
              style={
                lowerIsBetter
                  ? {
                      left: `${position}%`,
                      right: 0,
                      backgroundColor: color,
                      opacity: 0.28,
                    }
                  : {
                      left: 0,
                      width: `${position}%`,
                      backgroundColor: color,
                      opacity: 0.28,
                    }
              }
            />
            {/* Marker. */}
            <div
              className="absolute top-1/2 h-full w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-500 ease-[var(--ease-out-quint)]"
              style={{
                left: `${Math.min(Math.max(position, 1.5), 98.5)}%`,
                backgroundColor: color,
              }}
            />
          </>
        )}
      </div>

      {isBest ? (
        <span
          className="text-good shrink-0 text-[10px] font-semibold tracking-wide uppercase"
          aria-hidden
        >
          best
        </span>
      ) : null}
    </div>
  );
}

// `railBounds` and `seriesIndex` live in `lib/utils/bounds` so server
// components can call them — every export of a 'use client' module becomes a
// client reference and throws when invoked on the server.
export { railBounds, seriesIndex, type Bounds } from '@/lib/utils/bounds';
