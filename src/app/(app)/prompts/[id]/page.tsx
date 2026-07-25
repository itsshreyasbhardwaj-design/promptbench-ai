import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FlaskConical } from 'lucide-react';
import { PageBody, PageHeader } from '@/components/page-header';
import { Badge, Numeric, Panel, PanelHeader } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { VersionHistory } from '@/features/prompts/version-history';
import { requireSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/db';
import { extractVariables } from '@/lib/prompts/template';
import { isAppError } from '@/lib/core/errors';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  try {
    const session = await requireSession();
    const { id } = await params;
    const prompt = await getRepositories().prompts.findById(session.workspaceId, id);
    return { title: prompt?.name ?? 'Prompt' };
  } catch {
    return { title: 'Prompt' };
  }
}

export default async function PromptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const repos = getRepositories();

  let prompt;
  try {
    prompt = await repos.prompts.findById(session.workspaceId, id);
  } catch (error) {
    if (isAppError(error) && error.code === 'not_found') notFound();
    throw error;
  }
  if (!prompt) notFound();

  const [versions, current] = await Promise.all([
    repos.promptVersions.listForPrompt(session.workspaceId, id),
    prompt.currentVersionId
      ? repos.promptVersions.findById(session.workspaceId, prompt.currentVersionId)
      : Promise.resolve(null),
  ]);

  const variables = current ? extractVariables(current.template) : [];

  return (
    <>
      <PageHeader
        eyebrow={prompt.collection ?? 'Prompt'}
        title={prompt.name}
        description={prompt.description || undefined}
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href={`/playground?prompt=${prompt.id}`}>
              <FlaskConical />
              Open in playground
            </Link>
          </Button>
        }
      />

      <PageBody className="space-y-5">
        {prompt.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {prompt.tags.map((tag) => (
              <Badge key={tag} tone="neutral">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
          <div className="min-w-0 space-y-5">
            {current ? (
              <Panel className="space-y-3">
                <PanelHeader
                  title={`Current template · v${current.version}`}
                  description={current.changeNote || undefined}
                />
                {current.systemPrompt ? (
                  <div className="space-y-1.5">
                    <p className="eyebrow">System</p>
                    <pre className="border-line bg-canvas text-ink-muted overflow-x-auto rounded-md border px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
                      {current.systemPrompt}
                    </pre>
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <p className="eyebrow">Prompt</p>
                  <pre className="border-line bg-canvas text-ink overflow-x-auto rounded-md border px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
                    {current.template}
                  </pre>
                </div>
              </Panel>
            ) : null}

            <section>
              <h2 className="text-ink mb-3 text-[15px] font-semibold tracking-tight">
                Version history
              </h2>
              <VersionHistory
                promptId={prompt.id}
                versions={versions}
                currentVersionId={prompt.currentVersionId}
              />
            </section>
          </div>

          <aside className="space-y-4">
            <Panel className="space-y-3">
              <p className="eyebrow">Details</p>
              <dl className="space-y-2.5 text-[12px]">
                <Detail label="Versions" value={<Numeric value={versions.length} />} />
                <Detail
                  label="Created"
                  value={new Date(prompt.createdAt).toLocaleDateString()}
                />
                <Detail
                  label="Updated"
                  value={new Date(prompt.updatedAt).toLocaleDateString()}
                />
                {current ? (
                  <>
                    <Detail
                      label="Temperature"
                      value={<Numeric value={current.params.temperature} />}
                    />
                    <Detail
                      label="Max tokens"
                      value={
                        <Numeric value={current.params.maxTokens.toLocaleString()} />
                      }
                    />
                  </>
                ) : null}
              </dl>
            </Panel>

            {variables.length > 0 ? (
              <Panel className="space-y-3">
                <p className="eyebrow">Variables</p>
                <ul className="space-y-2">
                  {variables.map((variable) => (
                    <li key={variable.name} className="text-[12px]">
                      <code className="text-ink font-mono">{`{{${variable.name}}}`}</code>
                      <p className="text-ink-faint mt-0.5">
                        {variable.defaultValue !== null
                          ? `Default: ${variable.defaultValue}`
                          : 'Required'}
                        {variable.occurrences > 1
                          ? ` · used ${variable.occurrences}×`
                          : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </aside>
        </div>
      </PageBody>
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
