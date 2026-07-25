'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

/**
 * Layout and text primitives.
 *
 * Grouped in one module because they are trivial, always used together, and
 * splitting them into a dozen files would add import noise without adding
 * clarity. Anything with real behaviour (dialogs, selects, the spread rail)
 * lives in its own file.
 */

// ── Panel ───────────────────────────────────────────────────────────────────

export const Panel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { flush?: boolean }
>(({ className, flush = false, ...props }, ref) => (
  <div ref={ref} className={cn('panel', !flush && 'p-5', className)} {...props} />
));
Panel.displayName = 'Panel';

export function PanelHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="text-ink text-[15px] leading-tight font-semibold tracking-tight">
          {title}
        </h2>
        {description ? (
          <p className="text-ink-subtle mt-1 text-[13px] leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ── Badge ───────────────────────────────────────────────────────────────────

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-line bg-surface-raised text-ink-muted',
        signal: 'border-signal/35 bg-signal/12 text-signal',
        good: 'border-good/35 bg-good/12 text-good',
        warn: 'border-warn/35 bg-warn/12 text-warn',
        bad: 'border-bad/35 bg-bad/12 text-bad',
        info: 'border-info/35 bg-info/12 text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

// ── Numeric ─────────────────────────────────────────────────────────────────

/**
 * Every quantity in the product renders through this.
 *
 * Enforcing tabular monospace in one place is what makes columns of figures
 * actually line up — the central typographic rule of the design, and the thing
 * that makes a comparison table scannable rather than merely present.
 */
export function Numeric({
  value,
  unit,
  className,
  tone = 'default',
}: {
  value: React.ReactNode;
  unit?: string;
  className?: string;
  tone?: 'default' | 'muted' | 'good' | 'bad' | 'signal';
}) {
  const tones = {
    default: 'text-ink',
    muted: 'text-ink-subtle',
    good: 'text-good',
    bad: 'text-bad',
    signal: 'text-signal',
  } as const;

  return (
    <span data-numeric className={cn(tones[tone], className)}>
      {value}
      {unit ? <span className="text-ink-faint ml-0.5 text-[0.85em]">{unit}</span> : null}
    </span>
  );
}

/** Signed percentage change, coloured by direction. */
export function Delta({
  value,
  /** When true a decrease is the good outcome — latency, cost. */
  inverted = false,
  className,
}: {
  value: number | null;
  inverted?: boolean;
  className?: string;
}) {
  if (value === null) {
    return <span className="text-ink-faint text-xs">—</span>;
  }

  const positive = value > 0;
  const good = inverted ? !positive : positive;
  const neutral = Math.abs(value) < 0.05;

  return (
    <span
      data-numeric
      className={cn(
        'text-xs font-medium',
        neutral ? 'text-ink-faint' : good ? 'text-good' : 'text-bad',
        className,
      )}
    >
      {positive ? '+' : ''}
      {value.toFixed(1)}%
    </span>
  );
}

// ── Text ────────────────────────────────────────────────────────────────────

export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={cn('eyebrow', className)}>{children}</p>;
}

export function Separator({
  orientation = 'horizontal',
  className,
}: {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'bg-line',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
    />
  );
}

// ── Empty and loading states ────────────────────────────────────────────────

/**
 * Empty states are an invitation to act, so this always takes an action rather
 * than leaving the user at a dead end.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="border-line bg-surface-raised text-ink-subtle flex size-11 items-center justify-center rounded-xl border">
          {icon}
        </div>
      ) : null}
      <div className="max-w-sm space-y-1.5">
        <h3 className="text-ink text-sm font-semibold">{title}</h3>
        {description ? (
          <p className="text-ink-subtle text-[13px] leading-relaxed">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--color-surface-raised)_0%,var(--color-surface-overlay)_50%,var(--color-surface-raised)_100%)] bg-[length:200%_100%]',
        className,
      )}
    />
  );
}

// ── Form controls ───────────────────────────────────────────────────────────

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'border-line bg-surface text-ink h-9 w-full rounded-md border px-3 text-sm',
      'placeholder:text-ink-faint',
      'hover:border-line-strong transition-colors',
      'focus:border-signal focus:outline-none focus-visible:outline-none',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'border-line bg-surface text-ink w-full rounded-md border px-3 py-2.5 text-sm leading-relaxed',
      'placeholder:text-ink-faint resize-y',
      'hover:border-line-strong transition-colors',
      'focus:border-signal focus:outline-none focus-visible:outline-none',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

/**
 * Field label with an optional trailing hint.
 *
 * The hint sits *outside* the `<label>` element deliberately. Nesting it would
 * fold it into the control's accessible name — a field would announce as
 * "Prompt 1,204 tokens (est.)", and that name would change on every keystroke.
 * Keeping it adjacent leaves the name stable and meaningful while the hint
 * stays visible and readable in normal document order.
 */
export function Label({
  children,
  htmlFor,
  hint,
  className,
}: {
  children: React.ReactNode;
  htmlFor?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-baseline justify-between gap-2 text-[13px]', className)}
    >
      <label htmlFor={htmlFor} className="text-ink-muted font-medium">
        {children}
      </label>
      {hint ? <span className="text-ink-faint text-[11px]">{hint}</span> : null}
    </div>
  );
}

// ── Data table shell ────────────────────────────────────────────────────────

export function Table({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // Wide comparison tables must scroll inside their own container rather than
    // pushing the page sideways.
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)}>
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className,
  align = 'left',
}: {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      scope="col"
      className={cn(
        'border-line text-ink-subtle border-b px-3 py-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = 'left',
}: {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <td
      className={cn(
        'border-line/60 border-b px-3 py-2.5 align-middle',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}
