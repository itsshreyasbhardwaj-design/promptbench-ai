/**
 * Shared axis bounds for spread rails.
 *
 * Kept out of `components/ui/spread-rail.tsx` because that module is marked
 * `'use client'`, and every export of a client module becomes a client
 * reference — calling one from a server component throws at runtime even though
 * the function is pure. Server components compute bounds before rendering, so
 * these live here where both tiers can import them.
 */

export interface Bounds {
  min: number;
  max: number;
}

/**
 * Derives min/max across a set so a group of rails shares one axis.
 *
 * Rails computed against different ranges are not comparable, which would
 * quietly defeat the point of drawing them side by side.
 */
export function railBounds(values: Array<number | null | undefined>): Bounds {
  const clean = values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  if (clean.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...clean), max: Math.max(...clean) };
}

/** Stable series index for a model id, so a model keeps its colour everywhere. */
export function seriesIndex(modelId: string, allModelIds: string[]): number {
  const index = allModelIds.indexOf(modelId);
  return index === -1 ? 1 : (index % 8) + 1;
}
