'use client';

import * as React from 'react';
import { Check, Search, X } from 'lucide-react';
import { Badge, Input, Numeric } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/overlays';
import { MODEL_CATALOG, PROVIDER_LABELS, listProviders } from '@/lib/models/catalog';
import { formatTokens } from '@/lib/models/cost';
import { cn } from '@/lib/utils/cn';
import type { ProviderId } from '@/lib/core/types';

/**
 * Model selection.
 *
 * The catalog spans ten providers, so browsing is filtered by provider and free
 * text rather than presented as one long list. Price and context window are
 * shown inline because those are the two facts that actually decide the
 * shortlist — a model is usually ruled out on cost or context long before
 * anyone considers its quality.
 */
export function ModelPicker({
  selected,
  onChange,
  max,
}: {
  selected: string[];
  onChange: (modelIds: string[]) => void;
  max: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [provider, setProvider] = React.useState<ProviderId | 'all'>('all');

  const providers = React.useMemo(() => listProviders(), []);

  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return MODEL_CATALOG.filter((model) => {
      if (provider !== 'all' && model.provider !== provider) return false;
      if (!query) return true;
      return (
        model.name.toLowerCase().includes(query) ||
        model.id.toLowerCase().includes(query) ||
        PROVIDER_LABELS[model.provider].toLowerCase().includes(query)
      );
    });
  }, [search, provider]);

  const atCapacity = selected.length >= max;

  const toggle = (modelId: string) => {
    if (selected.includes(modelId)) {
      onChange(selected.filter((id) => id !== modelId));
    } else if (!atCapacity) {
      onChange([...selected, modelId]);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map((modelId) => {
          const model = MODEL_CATALOG.find((m) => m.id === modelId);
          return (
            <span
              key={modelId}
              className="border-line bg-surface-raised text-ink inline-flex items-center gap-1.5 rounded-md border py-1 pr-1 pl-2.5 text-[12px]"
            >
              {model?.name ?? modelId}
              <button
                type="button"
                onClick={() => onChange(selected.filter((id) => id !== modelId))}
                className="text-ink-faint hover:bg-surface-overlay hover:text-ink rounded p-0.5 transition-colors"
                aria-label={`Remove ${model?.name ?? modelId}`}
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="xs">
              Add model
            </Button>
          </DialogTrigger>

          <DialogContent
            title="Select models"
            description={`Choose up to ${max} models to compare on the same prompt.`}
            className="max-w-2xl"
          >
            <div className="space-y-3">
              <div className="relative">
                <Search
                  className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search models or providers"
                  className="pl-9"
                  aria-label="Search models"
                  autoFocus
                />
              </div>

              <div className="flex flex-wrap gap-1">
                <FilterChip
                  active={provider === 'all'}
                  onClick={() => setProvider('all')}
                  label="All"
                />
                {providers.map((id) => (
                  <FilterChip
                    key={id}
                    active={provider === id}
                    onClick={() => setProvider(id)}
                    label={PROVIDER_LABELS[id]}
                  />
                ))}
              </div>

              <div className="max-h-[46vh] space-y-1 overflow-y-auto pr-1">
                {filtered.length === 0 ? (
                  <p className="text-ink-faint py-8 text-center text-[13px]">
                    No models match “{search}”.
                  </p>
                ) : (
                  filtered.map((model) => {
                    const isSelected = selected.includes(model.id);
                    const disabled = !isSelected && atCapacity;

                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => toggle(model.id)}
                        disabled={disabled}
                        aria-pressed={isSelected}
                        className={cn(
                          'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                          isSelected
                            ? 'border-signal/45 bg-signal/[0.08]'
                            : 'border-line hover:border-line-strong hover:bg-surface-raised',
                          disabled && 'cursor-not-allowed opacity-40',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                            isSelected
                              ? 'border-signal bg-signal text-signal-ink'
                              : 'border-line-strong',
                          )}
                          aria-hidden
                        >
                          {isSelected ? (
                            <Check className="size-3" strokeWidth={3} />
                          ) : null}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="text-ink text-[13px] font-medium">
                              {model.name}
                            </span>
                            <Badge tone="neutral">
                              {PROVIDER_LABELS[model.provider]}
                            </Badge>
                            {model.judgeCapable ? <Badge tone="info">judge</Badge> : null}
                          </span>
                          <span className="text-ink-subtle mt-1 block text-[12px] leading-relaxed">
                            {model.description}
                          </span>
                          <span className="text-ink-faint mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
                            <span>
                              <Numeric
                                value={`$${model.pricing.inputPerMillion}`}
                                tone="muted"
                              />{' '}
                              in /{' '}
                              <Numeric
                                value={`$${model.pricing.outputPerMillion}`}
                                tone="muted"
                              />{' '}
                              out per 1M
                            </span>
                            <span>
                              <Numeric
                                value={formatTokens(model.contextWindow)}
                                tone="muted"
                              />{' '}
                              context
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="border-line flex items-center justify-between border-t pt-3">
                <p className="text-ink-subtle text-[12px]">
                  <Numeric value={selected.length} />
                  <span className="text-ink-faint"> of {max} selected</span>
                </p>
                <Button variant="primary" size="sm" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {atCapacity ? (
        <p className="text-ink-faint text-[11px]">
          Maximum of {max} models per comparison. Remove one to add another.
        </p>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-signal/45 bg-signal/12 text-signal'
          : 'border-line text-ink-subtle hover:border-line-strong hover:text-ink',
      )}
    >
      {label}
    </button>
  );
}
