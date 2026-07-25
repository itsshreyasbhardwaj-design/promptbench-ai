'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FlaskConical, Search, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, EmptyState, Input, Panel } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/overlays';
import type { PromptRecord } from '@/lib/db/models';
import { cn } from '@/lib/utils/cn';

/**
 * Prompt library.
 *
 * Filtering runs client-side over the already-loaded page. A workspace's prompt
 * count is in the hundreds, not the millions, so a round trip per keystroke
 * would add latency and server load for no benefit — the server-side filter on
 * `/api/v1/prompts` exists for API consumers and for when a workspace outgrows
 * a single page.
 */
export function PromptLibrary({
  prompts,
  collections,
  tags,
}: {
  prompts: PromptRecord[];
  collections: string[];
  tags: Array<{ tag: string; count: number }>;
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState('');
  const [collection, setCollection] = React.useState<string | null>(null);
  const [activeTags, setActiveTags] = React.useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);

  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase();

    return prompts.filter((prompt) => {
      if (favoritesOnly && !prompt.favorite) return false;
      if (collection && prompt.collection !== collection) return false;
      if (activeTags.length > 0 && !activeTags.every((t) => prompt.tags.includes(t))) {
        return false;
      }
      if (!query) return true;
      return (
        prompt.name.toLowerCase().includes(query) ||
        prompt.description.toLowerCase().includes(query) ||
        prompt.tags.some((t) => t.toLowerCase().includes(query))
      );
    });
  }, [prompts, search, collection, activeTags, favoritesOnly]);

  const toggleTag = (tag: string) => {
    setActiveTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
    );
  };

  const toggleFavorite = async (prompt: PromptRecord) => {
    try {
      const response = await fetch(`/api/v1/prompts/${prompt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite: !prompt.favorite }),
      });
      if (!response.ok) throw new Error('Update failed.');
      router.refresh();
    } catch {
      toast.error('Could not update the prompt', {
        description: 'Check your connection and try again.',
      });
    }
  };

  const hasFilters = Boolean(search || collection || activeTags.length || favoritesOnly);

  return (
    <div className="grid gap-5 lg:grid-cols-[200px_1fr]">
      <aside className="space-y-5">
        <div className="space-y-1">
          <FilterButton
            active={!collection && !favoritesOnly}
            onClick={() => {
              setCollection(null);
              setFavoritesOnly(false);
            }}
            label="All prompts"
            count={prompts.length}
          />
          <FilterButton
            active={favoritesOnly}
            onClick={() => {
              setFavoritesOnly(true);
              setCollection(null);
            }}
            label="Favourites"
            count={prompts.filter((p) => p.favorite).length}
          />
        </div>

        {collections.length > 0 ? (
          <div>
            <p className="eyebrow mb-2 px-2">Collections</p>
            <div className="space-y-0.5">
              {collections.map((name) => (
                <FilterButton
                  key={name}
                  active={collection === name}
                  onClick={() => {
                    setCollection(collection === name ? null : name);
                    setFavoritesOnly(false);
                  }}
                  label={name}
                  count={prompts.filter((p) => p.collection === name).length}
                />
              ))}
            </div>
          </div>
        ) : null}

        {tags.length > 0 ? (
          <div>
            <p className="eyebrow mb-2 px-2">Tags</p>
            <div className="flex flex-wrap gap-1 px-1">
              {tags.slice(0, 14).map(({ tag, count }) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  aria-pressed={activeTags.includes(tag)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                    activeTags.includes(tag)
                      ? 'border-signal/45 bg-signal/12 text-signal'
                      : 'border-line text-ink-subtle hover:border-line-strong hover:text-ink',
                  )}
                >
                  {tag}
                  <span className="text-ink-faint ml-1">{count}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="relative">
          <Search
            className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search prompts by name, description or tag"
            className="pl-9"
            aria-label="Search prompts"
          />
        </div>

        {filtered.length === 0 ? (
          <Panel flush>
            <EmptyState
              icon={<FlaskConical className="size-5" />}
              title={hasFilters ? 'No prompts match those filters' : 'No prompts yet'}
              description={
                hasFilters
                  ? 'Try a broader search, or clear the active filters.'
                  : 'Write a prompt in the playground and save it. Saved prompts are versioned, so you keep a full history of what changed and why.'
              }
              action={
                hasFilters ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSearch('');
                      setCollection(null);
                      setActiveTags([]);
                      setFavoritesOnly(false);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button asChild variant="primary" size="sm">
                    <Link href="/playground">Open the playground</Link>
                  </Button>
                )
              }
            />
          </Panel>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((prompt) => (
              <li key={prompt.id}>
                <article className="panel group hover:border-line-strong flex h-full flex-col p-4 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/prompts/${prompt.id}`}
                      className="text-ink hover:text-signal min-w-0 flex-1 text-[14px] font-semibold tracking-tight"
                    >
                      {prompt.name}
                    </Link>
                    <Tooltip
                      content={
                        prompt.favorite ? 'Remove from favourites' : 'Add to favourites'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => void toggleFavorite(prompt)}
                        className="hover:bg-surface-raised shrink-0 rounded p-1 transition-colors"
                        aria-label={
                          prompt.favorite ? 'Remove from favourites' : 'Add to favourites'
                        }
                        aria-pressed={prompt.favorite}
                      >
                        <Star
                          className={cn(
                            'size-3.5',
                            prompt.favorite
                              ? 'fill-signal text-signal'
                              : 'text-ink-faint group-hover:text-ink-subtle',
                          )}
                        />
                      </button>
                    </Tooltip>
                  </div>

                  {prompt.description ? (
                    <p className="text-ink-subtle mt-1.5 line-clamp-2 text-[12px] leading-relaxed">
                      {prompt.description}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-1">
                    {prompt.collection ? (
                      <Badge tone="neutral">{prompt.collection}</Badge>
                    ) : null}
                    {prompt.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} tone="neutral">
                        {tag}
                      </Badge>
                    ))}
                    {prompt.tags.length > 3 ? (
                      <Badge tone="neutral">+{prompt.tags.length - 3}</Badge>
                    ) : null}
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                    <span className="text-ink-faint text-[11px]">
                      Updated {new Date(prompt.updatedAt).toLocaleDateString()}
                    </span>
                    <Button asChild variant="ghost" size="xs">
                      <Link href={`/playground?prompt=${prompt.id}`}>
                        Open in playground
                      </Link>
                    </Button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
        active
          ? 'bg-surface-raised text-ink font-medium'
          : 'text-ink-subtle hover:bg-surface-raised/60 hover:text-ink',
      )}
    >
      <span className="truncate">{label}</span>
      <span data-numeric className="text-ink-faint shrink-0 text-[11px]">
        {count}
      </span>
    </button>
  );
}
