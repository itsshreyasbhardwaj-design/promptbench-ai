import type { Metadata } from 'next';
import { PageBody, PageHeader } from '@/components/page-header';
import { Badge, Numeric, Panel, PanelHeader } from '@/components/ui/primitives';
import { ApiKeyManager } from '@/features/settings/api-key-manager';
import { requireSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/db';
import { runtimeCapabilities, serverEnv } from '@/lib/env';
import { CATALOG_VERSION, MODEL_CATALOG, listProviders } from '@/lib/models/catalog';
import { ROLE_DESCRIPTIONS } from '@/lib/auth/permissions';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await requireSession();
  const env = serverEnv();
  const capabilities = runtimeCapabilities(env);

  const repos = getRepositories();
  const [workspace, members, keys] = await Promise.all([
    repos.workspaces.findById(session.workspaceId),
    repos.members.list(session.workspaceId),
    repos.apiKeys.list(session.workspaceId),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Runtime configuration, team access and programmatic API keys."
      />

      <PageBody className="max-w-4xl space-y-5">
        <Panel className="space-y-4">
          <PanelHeader
            title="Runtime"
            description="What this installation currently has configured."
          />
          <dl className="grid gap-3 sm:grid-cols-2">
            <Capability
              label="Model responses"
              enabled={capabilities.liveModels}
              enabledText="Live via OpenRouter"
              disabledText="Deterministic local driver"
              hint={
                capabilities.liveModels
                  ? undefined
                  : 'Set OPENROUTER_API_KEY to route to real models.'
              }
            />
            <Capability
              label="Persistence"
              enabled={capabilities.persistentStorage}
              enabledText="Postgres"
              disabledText="In-memory"
              hint={
                capabilities.persistentStorage
                  ? undefined
                  : 'Data resets on restart. Set DATABASE_URL to persist.'
              }
            />
            <Capability
              label="Authentication"
              enabled={capabilities.managedAuth}
              enabledText="Clerk"
              disabledText="Local identity"
              hint={
                capabilities.managedAuth
                  ? undefined
                  : 'Single local user. Set CLERK_SECRET_KEY for multi-tenant auth.'
              }
            />
            <div>
              <dt className="text-ink-faint text-[11px] tracking-[0.06em] uppercase">
                Model catalog
              </dt>
              <dd className="text-ink mt-1 text-[13px]">
                <Numeric value={MODEL_CATALOG.length} /> models ·{' '}
                <Numeric value={listProviders().length} /> providers
                <span className="text-ink-faint block text-[11px]">
                  Snapshot {CATALOG_VERSION}
                </span>
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel className="space-y-4">
          <PanelHeader
            title="Limits"
            description="Guardrails that cap how much one request can spend."
          />
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Limit label="Models per run" value={env.MAX_MODELS_PER_RUN} />
            <Limit label="Dataset rows" value={env.MAX_DATASET_ROWS.toLocaleString()} />
            <Limit
              label="Rate limit"
              value={`${env.RATE_LIMIT_REQUESTS}/${env.RATE_LIMIT_WINDOW_SECONDS}s`}
            />
            <Limit
              label="Provider timeout"
              value={`${Math.round(env.PROVIDER_TIMEOUT_MS / 1000)}s`}
            />
          </dl>
        </Panel>

        <Panel className="space-y-4">
          <PanelHeader
            title="Members"
            description={`${members.length} member${members.length === 1 ? '' : 's'} in ${
              workspace?.name ?? 'this workspace'
            }`}
          />
          <ul className="divide-line divide-y">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-ink truncate text-[13px] font-medium">
                    {member.displayName}
                  </p>
                  <p className="text-ink-faint truncate text-[11px]">{member.email}</p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge tone={member.role === 'owner' ? 'signal' : 'neutral'}>
                    {member.role}
                  </Badge>
                  <p className="text-ink-faint mt-1 max-w-[240px] text-[11px]">
                    {ROLE_DESCRIPTIONS[member.role]}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <ApiKeyManager
          initialKeys={keys.map(({ keyHash: _hash, ...rest }) => rest)}
          canManage={session.role === 'owner' || session.role === 'admin'}
        />
      </PageBody>
    </>
  );
}

function Capability({
  label,
  enabled,
  enabledText,
  disabledText,
  hint,
}: {
  label: string;
  enabled: boolean;
  enabledText: string;
  disabledText: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-ink-faint text-[11px] tracking-[0.06em] uppercase">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-center gap-2">
        <Badge tone={enabled ? 'good' : 'warn'}>
          {enabled ? enabledText : disabledText}
        </Badge>
      </dd>
      {hint ? <p className="text-ink-faint mt-1 text-[11px]">{hint}</p> : null}
    </div>
  );
}

function Limit({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-ink-faint text-[11px] tracking-[0.06em] uppercase">{label}</dt>
      <dd className="mt-1">
        <Numeric value={value} className="text-[15px] font-semibold" />
      </dd>
    </div>
  );
}
