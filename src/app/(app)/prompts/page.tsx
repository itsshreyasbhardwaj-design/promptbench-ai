import type { Metadata } from 'next';
import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import { PageBody, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { PromptLibrary } from '@/features/prompts/prompt-library';
import { requireSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Prompts',
  description: 'Your versioned prompt library.',
};

export const dynamic = 'force-dynamic';

export default async function PromptsPage() {
  const session = await requireSession();
  const repos = getRepositories();

  const [page, collections, tags] = await Promise.all([
    repos.prompts.list(session.workspaceId, { limit: 200 }),
    repos.prompts.listCollections(session.workspaceId),
    repos.prompts.listTags(session.workspaceId),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Library"
        title="Prompts"
        description="Every saved prompt is versioned. Edit freely — history is append-only, so you can always see what changed and roll back."
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href="/playground">
              <FlaskConical />
              New prompt
            </Link>
          </Button>
        }
      />
      <PageBody>
        <PromptLibrary prompts={page.items} collections={collections} tags={tags} />
      </PageBody>
    </>
  );
}
