import type { Metadata } from 'next';
import { Database } from 'lucide-react';
import { PageBody, PageHeader } from '@/components/page-header';
import { Badge, EmptyState, Numeric, Panel } from '@/components/ui/primitives';
import { DatasetUpload } from '@/features/datasets/dataset-upload';
import { requireSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Datasets',
  description: 'Upload test cases for batch evaluation across models.',
};

export const dynamic = 'force-dynamic';

export default async function DatasetsPage() {
  const session = await requireSession();
  const page = await getRepositories().datasets.list(session.workspaceId, { limit: 100 });

  return (
    <>
      <PageHeader
        eyebrow="Evaluation"
        title="Datasets"
        description="Run a prompt against hundreds of test cases at once. Each column becomes a prompt variable; a column named `expected` is passed to the judge as ground truth."
        actions={<DatasetUpload />}
      />

      <PageBody>
        {page.items.length === 0 ? (
          <Panel flush>
            <EmptyState
              icon={<Database className="size-5" />}
              title="No datasets yet"
              description="A single prompt tells you how a model handles one case. A dataset tells you how it handles the distribution — which is the thing that actually predicts production behaviour."
              action={<DatasetUpload />}
            />
          </Panel>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {page.items.map((dataset) => (
              <li key={dataset.id}>
                <article className="panel flex h-full flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-ink min-w-0 flex-1 text-[14px] font-semibold tracking-tight">
                      {dataset.name}
                    </h2>
                    <Badge tone="neutral">{dataset.format.toUpperCase()}</Badge>
                  </div>

                  {dataset.description ? (
                    <p className="text-ink-subtle mt-1.5 line-clamp-2 text-[12px] leading-relaxed">
                      {dataset.description}
                    </p>
                  ) : null}

                  <dl className="mt-3 flex gap-5 text-[12px]">
                    <div>
                      <dt className="text-ink-faint text-[10px] tracking-[0.06em] uppercase">
                        Rows
                      </dt>
                      <dd>
                        <Numeric
                          value={dataset.rowCount.toLocaleString()}
                          className="font-medium"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint text-[10px] tracking-[0.06em] uppercase">
                        Columns
                      </dt>
                      <dd>
                        <Numeric value={dataset.columns.length} className="font-medium" />
                      </dd>
                    </div>
                  </dl>

                  <p className="border-line text-ink-faint mt-3 border-t pt-3 font-mono text-[11px] leading-relaxed break-words">
                    {dataset.columns.slice(0, 8).join(' · ')}
                    {dataset.columns.length > 8
                      ? ` · +${dataset.columns.length - 8}`
                      : ''}
                  </p>

                  <p className="text-ink-faint mt-auto pt-3 text-[11px]">
                    Uploaded {new Date(dataset.createdAt).toLocaleDateString()}
                  </p>
                </article>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
