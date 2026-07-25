'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium ' +
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ' +
    'disabled:pointer-events-none disabled:opacity-45 ' +
    'active:scale-[0.985] [&_svg]:shrink-0 [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        // The one filled button on a screen. Copper on graphite is the signal
        // colour, and it marks the single primary action.
        primary:
          'bg-signal text-signal-ink hover:bg-signal-hot shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset]',
        secondary:
          'bg-surface-raised text-ink border border-line hover:bg-surface-overlay hover:border-line-strong',
        ghost: 'text-ink-muted hover:bg-surface-raised hover:text-ink',
        outline:
          'border border-line-strong bg-transparent text-ink hover:bg-surface-raised',
        danger: 'bg-bad text-canvas hover:opacity-90',
        link: 'text-signal underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        xs: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
        sm: 'h-8 px-3 text-[13px] [&_svg]:size-4',
        md: 'h-9 px-4 text-sm [&_svg]:size-4',
        lg: 'h-11 px-6 text-[15px] [&_svg]:size-[18px]',
        icon: 'h-9 w-9 [&_svg]:size-4',
        'icon-sm': 'h-8 w-8 [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Renders the child element instead of a `<button>`, for links. */
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';

    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        // Announces the pending state to assistive tech, which a spinner alone
        // does not.
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
