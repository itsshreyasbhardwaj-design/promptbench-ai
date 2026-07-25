import type { Metadata } from 'next';
import { PageBody, PageHeader } from '@/components/page-header';
import { Playground } from '@/features/playground/playground';
import { SyntheticNotice } from '@/components/synthetic-notice';
import { requireSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/db';
import { serverEnv } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Playground',
  description: 'Run one prompt against many models and watch the responses stream in.',
};

export const dynamic = 'force-dynamic';

/**
 * The playground accepts `?prompt=<id>` so "open in playground" from the
 * library lands with the prompt's current version already loaded.
 */
export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const promptId = typeof params.prompt === 'string' ? params.prompt : null;

  let initial: React.ComponentProps<typeof Playground>['initial'];

  if (promptId) {
    const repos = getRepositories();
    const prompt = await repos.prompts.findById(session.workspaceId, promptId);
    if (prompt?.currentVersionId) {
      const version = await repos.promptVersions.findById(
        session.workspaceId,
        prompt.currentVersionId,
      );
      if (version) {
        initial = {
          promptId: prompt.id,
          name: prompt.name,
          template: version.template,
          systemPrompt: version.systemPrompt,
          params: version.params,
        };
      }
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Compare"
        title={initial?.name ?? 'Playground'}
        description="One prompt, many models, side by side. Responses stream as each model answers, with latency, tokens and cost measured per call."
      />
      <PageBody className="space-y-4">
        <SyntheticNotice />
        <Playground maxModels={serverEnv().MAX_MODELS_PER_RUN} initial={initial} />
      </PageBody>
    </>
  );
}
