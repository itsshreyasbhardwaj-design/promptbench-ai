'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Label, Numeric, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/overlays';
import { formatFromFilename, parseDataset } from '@/lib/datasets/parse';
import type { DatasetFormat } from '@/lib/db/models';
import { cn } from '@/lib/utils/cn';

const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Dataset upload.
 *
 * The file is parsed in the browser first so the user sees the detected columns
 * and row count — and any parse error — before anything is sent. Discovering a
 * malformed CSV after a round trip, or worse partway through a paid benchmark,
 * is the failure this prevents.
 */
export function DatasetUpload() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [content, setContent] = React.useState('');
  const [format, setFormat] = React.useState<DatasetFormat>('csv');
  const [dragging, setDragging] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const preview = React.useMemo(() => {
    if (!content.trim()) return null;
    try {
      const parsed = parseDataset(content, format, { maxRows: 5000 });
      return { ok: true as const, ...parsed };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : 'Could not parse the file.',
      };
    }
  }, [content, format]);

  const readFile = React.useCallback(async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast.error('File is too large', {
        description: `Maximum is ${MAX_FILE_BYTES / 1024 / 1024} MB; this file is ${(
          file.size /
          1024 /
          1024
        ).toFixed(1)} MB.`,
      });
      return;
    }

    setContent(await file.text());
    setFormat(formatFromFilename(file.name));
    setName((current) => current || file.name.replace(/\.[^.]+$/, ''));
  }, []);

  const submit = async () => {
    if (!name.trim() || !content.trim() || !preview?.ok) return;
    setSaving(true);

    try {
      const response = await fetch('/api/v1/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description, format, content }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? 'Upload failed.');
      }

      const payload = await response.json();
      const warnings: string[] = payload.data?.warnings ?? [];

      toast.success('Dataset uploaded', {
        description: warnings.length
          ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}: ${warnings[0]}`
          : `${payload.data.dataset.rowCount} rows ready for batch evaluation.`,
      });

      setOpen(false);
      setName('');
      setDescription('');
      setContent('');
      router.refresh();
    } catch (error) {
      toast.error('Upload failed', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <Upload />
          Upload dataset
        </Button>
      </DialogTrigger>

      <DialogContent
        title="Upload dataset"
        description="CSV, JSON or JSONL. Column names become prompt variables, and a column named `expected` is treated as ground truth."
        className="max-w-xl"
      >
        <div className="space-y-4">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) void readFile(file);
            }}
            className={cn(
              'rounded-lg border border-dashed px-4 py-8 text-center transition-colors',
              dragging ? 'border-signal bg-signal/[0.06]' : 'border-line-strong',
            )}
          >
            <FileUp className="text-ink-faint mx-auto size-6" aria-hidden />
            <p className="text-ink-muted mt-2 text-[13px]">
              Drop a file here, or{' '}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-signal underline-offset-2 hover:underline"
              >
                browse
              </button>
            </p>
            <p className="text-ink-faint mt-1 text-[11px]">
              CSV, JSON or JSONL · up to {MAX_FILE_BYTES / 1024 / 1024} MB
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.json,.jsonl,.ndjson,text/csv,application/json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
          </div>

          {preview ? (
            preview.ok ? (
              <div className="border-line bg-surface-raised rounded-lg border px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                  <span className="text-ink">
                    <Numeric value={preview.rows.length} /> rows
                  </span>
                  <span className="text-ink">
                    <Numeric value={preview.columns.length} /> columns
                  </span>
                  <span className="text-ink-faint uppercase">{format}</span>
                </div>
                <p className="text-ink-subtle mt-1.5 font-mono text-[11px] break-words">
                  {preview.columns.join(' · ')}
                </p>
                {preview.warnings.length > 0 ? (
                  <ul className="border-line text-warn mt-2 space-y-0.5 border-t pt-2 text-[11px]">
                    {preview.warnings.slice(0, 3).map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <div className="border-bad/30 bg-bad/[0.07] text-ink rounded-lg border px-3 py-2.5 text-[12px]">
                {preview.message}
              </div>
            )
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="dataset-name">Name</Label>
            <Input
              id="dataset-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Support triage — 200 cases"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dataset-description" hint="optional">
              Description
            </Label>
            <Textarea
              id="dataset-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Where this came from and what it tests."
              rows={2}
            />
          </div>

          <div className="border-line flex justify-end gap-2 border-t pt-3">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={submit}
              loading={saving}
              disabled={!name.trim() || !preview?.ok}
            >
              Upload
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
