'use client';

import * as React from 'react';
import { Play, RotateCcw, Save, Settings2, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Input,
  Label,
  Numeric,
  Panel,
  Textarea,
} from '@/components/ui/primitives';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  Slider,
  Tooltip,
} from '@/components/ui/overlays';
import { ModelPicker } from '@/features/playground/model-picker';
import { ResponsePane } from '@/features/playground/response-pane';
import { useComparison } from '@/features/playground/use-comparison';
import { extractVariables, renderTemplate } from '@/lib/prompts/template';
import { DEFAULT_MODEL_SELECTION, requireModel } from '@/lib/models/catalog';
import { estimateTokens, formatUsd, projectRunCost } from '@/lib/models/cost';
import { DEFAULT_COMPLETION_PARAMS, type CompletionParams } from '@/lib/core/types';
import { cn } from '@/lib/utils/cn';

export interface PlaygroundProps {
  maxModels: number;
  /** Pre-loads the editor when arriving from a saved prompt. */
  initial?: {
    promptId?: string;
    name?: string;
    template?: string;
    systemPrompt?: string;
    params?: CompletionParams;
  };
}

/**
 * The playground.
 *
 * Left column authors the prompt, right column streams the comparison. The
 * projected cost is shown *before* dispatch because fanning one prompt out to
 * eight models is the single easiest way to spend real money by accident, and
 * a number after the fact is not a control.
 */
export function Playground({ maxModels, initial }: PlaygroundProps) {
  const [template, setTemplate] = React.useState(initial?.template ?? '');
  const [systemPrompt, setSystemPrompt] = React.useState(initial?.systemPrompt ?? '');
  const [variables, setVariables] = React.useState<Record<string, string>>({});
  const [modelIds, setModelIds] = React.useState<string[]>([...DEFAULT_MODEL_SELECTION]);
  const [params, setParams] = React.useState<CompletionParams>(
    initial?.params ?? DEFAULT_COMPLETION_PARAMS,
  );

  const { panes, running, error, run, cancel, reset } = useComparison();

  const declaredVariables = React.useMemo(() => extractVariables(template), [template]);

  const rendered = React.useMemo(
    () => renderTemplate(template, variables),
    [template, variables],
  );

  const missing = rendered.missing;
  const canRun = template.trim().length > 0 && modelIds.length > 0 && !running;

  const projection = React.useMemo(() => {
    if (modelIds.length === 0 || !template.trim()) return null;
    try {
      const models = modelIds.map((id) => requireModel(id));
      return projectRunCost(models, rendered.text, params.maxTokens);
    } catch {
      return null;
    }
  }, [modelIds, template, rendered.text, params.maxTokens]);

  const promptTokens = React.useMemo(
    () => estimateTokens(`${systemPrompt}\n${rendered.text}`),
    [systemPrompt, rendered.text],
  );

  // Shared axis bounds so every pane's rail measures against the same range.
  const bounds = React.useMemo(() => {
    const latencies = panes
      .map((p) => p.result?.latencyMs)
      .filter((v): v is number => typeof v === 'number');
    const costs = panes
      .map((p) => p.result?.cost.totalCostUsd)
      .filter((v): v is number => typeof v === 'number');

    return {
      latency: {
        min: latencies.length ? Math.min(...latencies) : 0,
        max: latencies.length ? Math.max(...latencies) : 0,
      },
      cost: {
        min: costs.length ? Math.min(...costs) : 0,
        max: costs.length ? Math.max(...costs) : 0,
      },
    };
  }, [panes]);

  const handleRun = React.useCallback(() => {
    if (!canRun) return;
    void run({ template, systemPrompt, variables, modelIds, params });
  }, [canRun, run, template, systemPrompt, variables, modelIds, params]);

  // Cmd/Ctrl+Enter runs — the expected shortcut in every editor-plus-run tool.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        handleRun();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRun]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(340px,420px)_1fr]">
      <div className="space-y-4">
        <Panel className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="system-prompt" hint="optional">
              System prompt
            </Label>
            <Textarea
              id="system-prompt"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="You are a precise technical assistant…"
              rows={2}
              className="font-mono text-[12px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="template"
              hint={`${promptTokens.toLocaleString()} tokens (est.)`}
            >
              Prompt
            </Label>
            <Textarea
              id="template"
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
              placeholder={'Summarise this in three bullets:\n\n{{input}}'}
              rows={10}
              className="font-mono text-[12px]"
              aria-describedby="template-help"
            />
            <p id="template-help" className="text-ink-faint text-[11px]">
              Use <code className="text-ink-subtle font-mono">{'{{name}}'}</code> for
              variables, or{' '}
              <code className="text-ink-subtle font-mono">{'{{name|default}}'}</code> to
              supply a fallback.
            </p>
          </div>

          {declaredVariables.length > 0 ? (
            <div className="border-line space-y-2 border-t pt-3.5">
              <p className="eyebrow">Variables</p>
              {declaredVariables.map((variable) => (
                <div key={variable.name} className="space-y-1">
                  <Label
                    htmlFor={`var-${variable.name}`}
                    hint={
                      variable.defaultValue !== null
                        ? `default: ${variable.defaultValue.slice(0, 24)}`
                        : 'required'
                    }
                  >
                    {variable.name}
                  </Label>
                  <Input
                    id={`var-${variable.name}`}
                    value={variables[variable.name] ?? ''}
                    onChange={(event) =>
                      setVariables((current) => ({
                        ...current,
                        [variable.name]: event.target.value,
                      }))
                    }
                    placeholder={variable.defaultValue ?? `Value for ${variable.name}`}
                    className={cn(
                      'font-mono text-[12px]',
                      missing.includes(variable.name) && 'border-warn/50',
                    )}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </Panel>

        <Panel className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Models</p>
            <ParamsDialog params={params} onChange={setParams} />
          </div>

          <ModelPicker selected={modelIds} onChange={setModelIds} max={maxModels} />

          {projection ? (
            <div className="border-line flex items-baseline justify-between border-t pt-3 text-[12px]">
              <span className="text-ink-subtle">Projected cost</span>
              <Tooltip content="Upper bound: assumes every model emits its full max-tokens budget. Actual spend is usually lower.">
                <span className="cursor-help">
                  <Numeric
                    value={`≤ ${formatUsd(projection.totalUsd)}`}
                    className="font-medium"
                  />
                </span>
              </Tooltip>
            </div>
          ) : null}
        </Panel>

        <div className="flex gap-2">
          {running ? (
            <Button variant="secondary" size="md" onClick={cancel} className="flex-1">
              <Square />
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={handleRun}
              disabled={!canRun}
              className="flex-1"
            >
              <Play />
              Run comparison
            </Button>
          )}

          <Tooltip content="Clear results">
            <Button
              variant="ghost"
              size="icon"
              onClick={reset}
              disabled={panes.length === 0}
              aria-label="Clear results"
            >
              <RotateCcw />
            </Button>
          </Tooltip>

          <SavePromptButton
            template={template}
            systemPrompt={systemPrompt}
            params={params}
            defaultName={initial?.name}
          />
        </div>

        {missing.length > 0 ? (
          <p className="text-warn text-[12px]">
            {missing.length} variable{missing.length > 1 ? 's have' : ' has'} no value and
            will render empty: {missing.join(', ')}.
          </p>
        ) : null}

        <p className="text-ink-faint text-center text-[11px]">
          <kbd className="border-line bg-surface-raised rounded border px-1.5 py-0.5 font-mono text-[10px]">
            ⌘
          </kbd>{' '}
          +{' '}
          <kbd className="border-line bg-surface-raised rounded border px-1.5 py-0.5 font-mono text-[10px]">
            ↵
          </kbd>{' '}
          to run
        </p>
      </div>

      <div className="min-w-0">
        {error ? (
          <div className="border-bad/30 bg-bad/[0.07] text-ink mb-4 rounded-lg border px-4 py-3 text-[13px]">
            {error}
          </div>
        ) : null}

        {panes.length === 0 ? (
          <Panel className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-center">
            <div className="graph-paper border-line flex size-16 items-center justify-center rounded-xl border">
              <Play className="text-ink-faint size-5" />
            </div>
            <div className="max-w-xs space-y-1">
              <h2 className="text-ink text-sm font-semibold">Nothing running yet</h2>
              <p className="text-ink-subtle text-[13px] leading-relaxed">
                Write a prompt, pick your models, and run. Responses stream in side by
                side as each model answers.
              </p>
            </div>
          </Panel>
        ) : (
          <div
            className={cn(
              'grid gap-3',
              panes.length === 1 && 'grid-cols-1',
              panes.length === 2 && 'grid-cols-1 xl:grid-cols-2',
              panes.length >= 3 && 'grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3',
            )}
          >
            {panes.map((pane, index) => (
              <ResponsePane
                key={pane.modelId}
                pane={pane}
                seriesIndex={index + 1}
                bounds={bounds}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ParamsDialog({
  params,
  onChange,
}: {
  params: CompletionParams;
  onChange: (params: CompletionParams) => void;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="xs">
          <Settings2 />
          Parameters
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Sampling parameters"
        description="Applied identically to every model in the comparison."
      >
        <div className="space-y-5">
          <ParamSlider
            label="Temperature"
            hint="0 is deterministic; 2 is maximally random."
            value={params.temperature}
            min={0}
            max={2}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(temperature) => onChange({ ...params, temperature })}
          />
          <ParamSlider
            label="Top P"
            hint="Nucleus sampling cutoff. Leave at 1 unless you are also lowering temperature."
            value={params.topP}
            min={0}
            max={1}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(topP) => onChange({ ...params, topP })}
          />
          <ParamSlider
            label="Max tokens"
            hint="Upper bound on the response. Models with a lower ceiling are clamped to theirs."
            value={params.maxTokens}
            min={64}
            max={8192}
            step={64}
            format={(v) => v.toLocaleString()}
            onChange={(maxTokens) => onChange({ ...params, maxTokens })}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ParamSlider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-ink-muted text-[13px] font-medium">{label}</span>
        <Numeric value={format(value)} className="text-[13px]" />
      </div>
      <Slider
        value={value}
        onValueChange={onChange}
        min={min}
        max={max}
        step={step}
        ariaLabel={label}
      />
      <p className="text-ink-faint text-[11px] leading-relaxed">{hint}</p>
    </div>
  );
}

function SavePromptButton({
  template,
  systemPrompt,
  params,
  defaultName,
}: {
  template: string;
  systemPrompt: string;
  params: CompletionParams;
  defaultName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(defaultName ?? '');
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    if (!name.trim() || !template.trim()) return;
    setSaving(true);
    try {
      const response = await fetch('/api/v1/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          template,
          systemPrompt,
          params,
          tags: [],
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? 'Could not save the prompt.');
      }

      toast.success('Prompt saved', {
        description: `“${name.trim()}” is in your library.`,
      });
      setOpen(false);
      setName('');
    } catch (caught) {
      toast.error('Save failed', {
        description: caught instanceof Error ? caught.message : 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip content="Save to library">
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={!template.trim()}
            aria-label="Save prompt to library"
          >
            <Save />
          </Button>
        </DialogTrigger>
      </Tooltip>

      <DialogContent
        title="Save prompt"
        description="Saved prompts are versioned, so later edits keep a full history."
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="prompt-name">Name</Label>
            <Input
              id="prompt-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Bug triage classifier"
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={save}
              loading={saving}
              disabled={!name.trim()}
            >
              Save prompt
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { Badge };
