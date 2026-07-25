'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { GitCompare, History, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Numeric, Panel } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
} from '@/components/ui/overlays';
import { diffLines, diffStats, type DiffLine } from '@/lib/prompts/diff';
import type { PromptVersionRecord } from '@/lib/db/models';
import { cn } from '@/lib/utils/cn';

/**
 * Version history with diff and rollback.
 *
 * Two versions are selected at a time and diffed line by line. The default
 * selection is the two most recent, because "what changed most recently" is the
 * question being asked the overwhelming majority of the time.
 */
export function VersionHistory({
  promptId,
  versions,
  currentVersionId,
}: {
  promptId: string;
  versions: PromptVersionRecord[];
  currentVersionId: string | null;
}) {
  const router = useRouter();

  // `versions` arrives newest-first.
  const [rightId, setRightId] = React.useState(versions[0]?.id ?? '');
  const [leftId, setLeftId] = React.useState(versions[1]?.id ?? versions[0]?.id ?? '');
  const [rollingBack, setRollingBack] = React.useState<string | null>(null);

  const left = versions.find((v) => v.id === leftId);
  const right = versions.find((v) => v.id === rightId);

  const diff = React.useMemo(() => {
    if (!left || !right) return [];
    return diffLines(left.template, right.template);
  }, [left, right]);

  const stats = React.useMemo(() => diffStats(diff), [diff]);

  const rollback = async (versionId: string) => {
    setRollingBack(versionId);
    try {
      const response = await fetch(`/api/v1/prompts/${promptId}/versions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? 'Rollback failed.');
      }
      const version = versions.find((v) => v.id === versionId);
      toast.success('Rolled back', {
        description: `A new version was created from v${version?.version}. Nothing was deleted.`,
      });
      router.refresh();
    } catch (caught) {
      toast.error('Rollback failed', {
        description: caught instanceof Error ? caught.message : 'Please try again.',
      });
    } finally {
      setRollingBack(null);
    }
  };

  if (versions.length === 0) {
    return (
      <Panel>
        <p className="text-ink-faint py-8 text-center text-[13px]">
          This prompt has no version history yet.
        </p>
      </Panel>
    );
  }

  return (
    <Tabs defaultValue="timeline">
      <TabsList className="mb-4">
        <TabsTrigger value="timeline">
          <History className="mr-1.5 inline size-3.5" />
          Timeline
        </TabsTrigger>
        <TabsTrigger value="diff">
          <GitCompare className="mr-1.5 inline size-3.5" />
          Compare
        </TabsTrigger>
      </TabsList>

      <TabsContent value="timeline">
        <ol className="space-y-2">
          {versions.map((version) => {
            const isCurrent = version.id === currentVersionId;
            return (
              <li key={version.id}>
                <Panel className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Numeric
                        value={`v${version.version}`}
                        className="text-[13px] font-semibold"
                      />
                      {isCurrent ? <Badge tone="signal">current</Badge> : null}
                      <span className="text-ink-faint text-[11px]">
                        {new Date(version.createdAt).toLocaleString()}
                      </span>
                    </div>

                    <p className="text-ink-muted mt-1.5 text-[13px] leading-relaxed">
                      {version.changeNote || 'No change note.'}
                    </p>

                    <div className="text-ink-faint mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                      <span>
                        temp <Numeric value={version.params.temperature} tone="muted" />
                      </span>
                      <span>
                        max tokens{' '}
                        <Numeric
                          value={version.params.maxTokens.toLocaleString()}
                          tone="muted"
                        />
                      </span>
                      <span>
                        <Numeric
                          value={version.template.split('\n').length}
                          tone="muted"
                        />{' '}
                        lines
                      </span>
                    </div>
                  </div>

                  {!isCurrent ? (
                    <Tooltip content="Creates a new version matching this one. History is preserved.">
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => void rollback(version.id)}
                        loading={rollingBack === version.id}
                      >
                        <RotateCcw />
                        Restore
                      </Button>
                    </Tooltip>
                  ) : null}
                </Panel>
              </li>
            );
          })}
        </ol>
      </TabsContent>

      <TabsContent value="diff" className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <VersionSelect
            label="From"
            versions={versions}
            value={leftId}
            onChange={setLeftId}
          />
          <VersionSelect
            label="To"
            versions={versions}
            value={rightId}
            onChange={setRightId}
          />

          <div className="ml-auto flex items-center gap-3 text-[12px]">
            <span className="text-good">
              +<Numeric value={stats.added} tone="good" />
            </span>
            <span className="text-bad">
              −<Numeric value={stats.removed} tone="bad" />
            </span>
            <span className="text-ink-faint">
              <Numeric value={stats.unchanged} tone="muted" /> unchanged
            </span>
          </div>
        </div>

        {leftId === rightId ? (
          <Panel>
            <p className="text-ink-faint py-8 text-center text-[13px]">
              Select two different versions to see a diff.
            </p>
          </Panel>
        ) : (
          <DiffView diff={diff} />
        )}
      </TabsContent>
    </Tabs>
  );
}

function VersionSelect({
  label,
  versions,
  value,
  onChange,
}: {
  label: string;
  versions: PromptVersionRecord[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-ink-muted block text-[13px] font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-line bg-surface text-ink hover:border-line-strong h-9 rounded-md border px-3 font-mono text-[12px] transition-colors"
      >
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            v{version.version} · {new Date(version.createdAt).toLocaleDateString()}
          </option>
        ))}
      </select>
    </div>
  );
}

function DiffView({ diff }: { diff: DiffLine[] }) {
  return (
    <Panel flush className="overflow-hidden">
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full border-collapse font-mono text-[12px]">
          <caption className="sr-only">
            Line-by-line differences between the two selected prompt versions
          </caption>
          <tbody>
            {diff.map((line, index) => (
              <tr
                key={index}
                className={cn(
                  line.op === 'insert' && 'bg-good/[0.09]',
                  line.op === 'delete' && 'bg-bad/[0.09]',
                )}
              >
                <td className="border-line text-ink-faint w-10 shrink-0 border-r px-2 py-0.5 text-right align-top text-[11px] select-none">
                  {line.oldLine ?? ''}
                </td>
                <td className="border-line text-ink-faint w-10 shrink-0 border-r px-2 py-0.5 text-right align-top text-[11px] select-none">
                  {line.newLine ?? ''}
                </td>
                <td
                  className={cn(
                    'w-5 px-1.5 py-0.5 text-center align-top select-none',
                    line.op === 'insert' && 'text-good',
                    line.op === 'delete' && 'text-bad',
                    line.op === 'equal' && 'text-ink-faint',
                  )}
                  aria-hidden
                >
                  {line.op === 'insert' ? '+' : line.op === 'delete' ? '−' : ''}
                </td>
                <td
                  className={cn(
                    'px-2 py-0.5 leading-relaxed break-words whitespace-pre-wrap',
                    line.op === 'equal' ? 'text-ink-muted' : 'text-ink',
                  )}
                >
                  {/* A screen reader gets the change type in words; sighted
                      users get the colour and the sign. */}
                  {line.op !== 'equal' ? (
                    <span className="sr-only">
                      {line.op === 'insert' ? 'Added: ' : 'Removed: '}
                    </span>
                  ) : null}
                  {line.text || ' '}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
