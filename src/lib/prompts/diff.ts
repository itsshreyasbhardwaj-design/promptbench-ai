/**
 * Line diffing for prompt versions.
 *
 * Deliberately dependency-free and separate from `lib/services/prompts`. The
 * diff UI is a client component, and importing it from the service module would
 * pull the repository layer — and with it the Postgres driver — into the browser
 * bundle. Pure functions that both tiers need live here.
 */

export type DiffOp = 'equal' | 'insert' | 'delete';

export interface DiffLine {
  op: DiffOp;
  text: string;
  /** 1-based line number in the old text, null for inserts. */
  oldLine: number | null;
  /** 1-based line number in the new text, null for deletes. */
  newLine: number | null;
}

/**
 * Line-level diff between two texts.
 *
 * Uses the classic longest-common-subsequence dynamic program. Prompts are
 * short enough that the O(n·m) table is irrelevant, and LCS produces a minimal,
 * stable diff — unlike a greedy line-by-line walk, which misaligns everything
 * below a single inserted line and makes small edits look like rewrites.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ op: 'equal', text: a[i]!, oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      result.push({ op: 'delete', text: a[i]!, oldLine: i + 1, newLine: null });
      i++;
    } else {
      result.push({ op: 'insert', text: b[j]!, oldLine: null, newLine: j + 1 });
      j++;
    }
  }

  while (i < a.length) {
    result.push({ op: 'delete', text: a[i]!, oldLine: i + 1, newLine: null });
    i++;
  }
  while (j < b.length) {
    result.push({ op: 'insert', text: b[j]!, oldLine: null, newLine: j + 1 });
    j++;
  }

  return result;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

export function diffStats(diff: DiffLine[]): DiffStats {
  return {
    added: diff.filter((d) => d.op === 'insert').length,
    removed: diff.filter((d) => d.op === 'delete').length,
    unchanged: diff.filter((d) => d.op === 'equal').length,
  };
}
