import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Page header.
 *
 * Every screen opens the same way — eyebrow, title, one line of orientation,
 * actions on the right — so a user always knows where the primary action is
 * without hunting for it.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-line flex flex-col gap-4 border-b px-4 py-6 md:flex-row md:items-end md:justify-between md:px-6 md:py-8',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <h1 className="text-ink text-xl font-semibold tracking-tight md:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="text-ink-subtle mt-1.5 max-w-2xl text-[13px] leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('px-4 py-6 md:px-6 md:py-8', className)}>{children}</div>;
}
