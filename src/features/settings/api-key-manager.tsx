'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, KeyRound, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Input,
  Label,
  Numeric,
  Panel,
  PanelHeader,
} from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/overlays';
import type { ApiKeyRecord } from '@/lib/db/models';

type SafeKey = Omit<ApiKeyRecord, 'keyHash'>;

/**
 * API key management.
 *
 * The plaintext key exists only in this component's state, for exactly as long
 * as the reveal dialog is open. It is never persisted, never re-fetchable, and
 * is cleared when the dialog closes — so the "copy it now" warning is the
 * literal truth rather than a formality.
 */
export function ApiKeyManager({
  initialKeys,
  canManage,
}: {
  initialKeys: SafeKey[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [revealed, setRevealed] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  const active = initialKeys.filter((key) => !key.revokedAt);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const response = await fetch('/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? 'Could not create the key.');
      }
      const payload = await response.json();
      setRevealed(payload.data.plaintext);
      setName('');
      router.refresh();
    } catch (error) {
      toast.error('Could not create key', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (keyId: string) => {
    try {
      const response = await fetch(`/api/v1/keys/${keyId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Revoke failed.');
      toast.success('Key revoked', {
        description: 'Any request using it will now be rejected.',
      });
      router.refresh();
    } catch {
      toast.error('Could not revoke the key');
    }
  };

  return (
    <Panel className="space-y-4">
      <PanelHeader
        title="API keys"
        description="Authenticate programmatic requests with Authorization: Bearer. Keys act with editor permissions."
        action={
          canManage ? (
            <Dialog
              open={open}
              onOpenChange={(next) => {
                setOpen(next);
                // Drop the plaintext the moment the dialog closes.
                if (!next) setRevealed(null);
              }}
            >
              <DialogTrigger asChild>
                <Button variant="secondary" size="sm">
                  <KeyRound />
                  New key
                </Button>
              </DialogTrigger>

              <DialogContent
                title={revealed ? 'Key created' : 'Create API key'}
                description={
                  revealed
                    ? 'Copy it now. This is the only time it will be shown.'
                    : 'Give the key a name that says where it will be used.'
                }
              >
                {revealed ? (
                  <RevealedKey value={revealed} onDone={() => setOpen(false)} />
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="key-name">Name</Label>
                      <Input
                        id="key-name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="CI pipeline"
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
                        onClick={create}
                        loading={creating}
                        disabled={!name.trim()}
                      >
                        Create key
                      </Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      {active.length === 0 ? (
        <p className="text-ink-faint py-6 text-center text-[13px]">
          No API keys yet.{' '}
          {canManage
            ? 'Create one to drive benchmarks from CI or a script.'
            : 'Ask a workspace admin to create one.'}
        </p>
      ) : (
        <ul className="divide-line divide-y">
          {active.map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-ink truncate text-[13px] font-medium">{key.name}</p>
                <p className="text-ink-faint truncate font-mono text-[11px]">
                  {key.keyPrefix}
                  {'•'.repeat(20)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span className="text-ink-faint text-[11px]">
                  {key.lastUsedAt
                    ? `Used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                    : 'Never used'}
                </span>
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void revoke(key.id)}
                    aria-label={`Revoke ${key.name}`}
                  >
                    <Trash2 className="text-ink-faint" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {initialKeys.some((key) => key.revokedAt) ? (
        <p className="border-line text-ink-faint border-t pt-3 text-[11px]">
          <Numeric value={initialKeys.filter((k) => k.revokedAt).length} tone="muted" />{' '}
          revoked key(s) retained for the audit trail.
        </p>
      ) : null}
    </Panel>
  );
}

function RevealedKey({ value, onDone }: { value: string; onDone: () => void }) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy', {
        description: 'Select the key and copy it manually.',
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="border-signal/35 bg-signal/[0.07] flex items-center gap-2 rounded-lg border px-3 py-2.5">
        <code className="text-ink min-w-0 flex-1 font-mono text-[12px] break-all">
          {value}
        </code>
        <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy API key">
          {copied ? <Check className="text-good" /> : <Copy />}
        </Button>
      </div>

      <Badge tone="warn">Not recoverable — store it in your secret manager now</Badge>

      <div className="border-line bg-canvas rounded-lg border p-3">
        <p className="text-ink-faint mb-1.5 text-[11px] tracking-[0.06em] uppercase">
          Example request
        </p>
        <pre className="text-ink-muted overflow-x-auto font-mono text-[11px] leading-relaxed">
          {`curl -X POST /api/v1/benchmarks \\
  -H "Authorization: Bearer ${value.slice(0, 14)}…" \\
  -H "Content-Type: application/json" \\
  -d '{"template":"Summarise: {{text}}",
       "modelIds":["openai/gpt-4o-mini"],
       "params":{"temperature":0.7,"maxTokens":1024,"topP":1}}'`}
        </pre>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={onDone}>
          I have saved it
        </Button>
      </div>
    </div>
  );
}
