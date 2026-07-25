'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Radix-backed interactive primitives.
 *
 * Radix supplies focus trapping, dismissal, typeahead and ARIA wiring — the
 * parts that are tedious to get right and invisible when wrong. Everything here
 * is presentation on top of that.
 */

// ── Dialog ──────────────────────────────────────────────────────────────────

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  children,
  className,
  title,
  description,
}: {
  children: React.ReactNode;
  className?: string;
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          'glass fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
          'rounded-xl border p-6 shadow-2xl',
          'max-h-[85vh] overflow-y-auto',
          className,
        )}
      >
        <div className="mb-4 pr-8">
          <DialogPrimitive.Title className="text-ink text-base font-semibold tracking-tight">
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="text-ink-subtle mt-1 text-[13px] leading-relaxed">
              {description}
            </DialogPrimitive.Description>
          ) : (
            // Radix warns without a description; an empty one keeps the a11y
            // tree clean when the title alone is sufficient.
            <DialogPrimitive.Description className="sr-only">
              {title}
            </DialogPrimitive.Description>
          )}
        </div>
        {children}
        <DialogPrimitive.Close
          className="text-ink-subtle hover:bg-surface-raised hover:text-ink absolute top-5 right-5 rounded-md p-1 transition-colors"
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// ── Tooltip ─────────────────────────────────────────────────────────────────

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={250} skipDelayDuration={0}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  children,
  content,
  side = 'top',
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="glass text-ink z-50 max-w-xs rounded-md border px-2.5 py-1.5 text-xs leading-relaxed shadow-lg"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.List
      className={cn(
        'border-line bg-surface inline-flex items-center gap-1 rounded-lg border p-1',
        className,
      )}
    >
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        'text-ink-subtle rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
        'hover:text-ink',
        'data-[state=active]:bg-surface-overlay data-[state=active]:text-ink',
        className,
      )}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.Content
      value={value}
      className={cn('focus-visible:outline-none', className)}
    >
      {children}
    </TabsPrimitive.Content>
  );
}

// ── Select ──────────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  className,
  ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'border-line bg-surface inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border px-3',
          'text-ink hover:border-line-strong text-sm transition-colors',
          'data-[placeholder]:text-ink-faint',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="text-ink-subtle size-4" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="glass z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border shadow-xl"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className={cn(
                  'text-ink relative flex cursor-pointer flex-col rounded-md px-2.5 py-2 pr-8 text-sm outline-none select-none',
                  'data-[highlighted]:bg-surface-overlay',
                )}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                {option.description ? (
                  <span className="text-ink-faint mt-0.5 text-[11px]">
                    {option.description}
                  </span>
                ) : null}
                <SelectPrimitive.ItemIndicator className="absolute top-2.5 right-2.5">
                  <Check className="text-signal size-3.5" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

// ── Switch ──────────────────────────────────────────────────────────────────

export function Switch({
  checked,
  onCheckedChange,
  id,
  ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={ariaLabel}
      className={cn(
        'border-line relative h-5 w-9 shrink-0 rounded-full border transition-colors',
        'data-[state=checked]:border-signal data-[state=checked]:bg-signal',
        'data-[state=unchecked]:bg-surface-raised',
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'bg-ink block size-3.5 rounded-full shadow-sm transition-transform',
          'translate-x-0.5 data-[state=checked]:translate-x-[18px]',
          'data-[state=checked]:bg-signal-ink',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

// ── Slider ──────────────────────────────────────────────────────────────────

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 1,
  step = 0.01,
  ariaLabel,
  className,
}: {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <SliderPrimitive.Root
      value={[value]}
      onValueChange={([next]) => onValueChange(next ?? min)}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      className={cn(
        'relative flex h-5 w-full touch-none items-center select-none',
        className,
      )}
    >
      <SliderPrimitive.Track className="bg-surface-raised relative h-1 w-full grow rounded-full">
        <SliderPrimitive.Range className="bg-signal absolute h-full rounded-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="border-signal bg-canvas block size-3.5 rounded-full border-2 transition-transform hover:scale-110" />
    </SliderPrimitive.Root>
  );
}
