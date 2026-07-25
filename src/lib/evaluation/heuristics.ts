import type { CriterionId, CriterionScore } from '@/lib/core/types';

/**
 * Locally computed criteria.
 *
 * These are cheap, deterministic proxies — not ground truth. They exist so that
 * high-volume dataset sweeps have *some* signal without a judge call per row,
 * and so the platform is useful with zero spend. Confidence is reported below
 * 1.0 deliberately: a readability formula is a weaker claim than a judge's.
 */

interface TextStats {
  characters: number;
  words: number;
  sentences: number;
  syllables: number;
  avgWordsPerSentence: number;
  avgSyllablesPerWord: number;
  /** Ratio of distinct words to total words, 0–1. */
  lexicalDiversity: number;
  /** Fraction of words that carry little information. */
  fillerRatio: number;
  hasStructure: boolean;
}

/**
 * Words that add length without adding information. Used to detect padding in
 * the conciseness score.
 */
const FILLER_WORDS = new Set([
  'basically',
  'actually',
  'essentially',
  'really',
  'very',
  'quite',
  'just',
  'simply',
  'literally',
  'certainly',
  'definitely',
  'obviously',
  'clearly',
  'furthermore',
  'moreover',
  'additionally',
  'however',
  'nevertheless',
  'importantly',
  'notably',
  'generally',
  'typically',
  'usually',
  'perhaps',
  'somewhat',
  'rather',
  'fairly',
  'extremely',
  'incredibly',
  'absolutely',
]);

export function analyseText(text: string): TextStats {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const sentences = trimmed.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().length > 0);
  const normalised = words.map((w) => w.toLowerCase().replace(/[^a-z0-9']/g, ''));
  const distinct = new Set(normalised.filter(Boolean));
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const fillers = normalised.filter((w) => FILLER_WORDS.has(w)).length;

  const sentenceCount = Math.max(sentences.length, 1);
  const wordCount = Math.max(words.length, 1);

  return {
    characters: trimmed.length,
    words: words.length,
    sentences: sentences.length,
    syllables,
    avgWordsPerSentence: words.length / sentenceCount,
    avgSyllablesPerWord: syllables / wordCount,
    lexicalDiversity: distinct.size / wordCount,
    fillerRatio: fillers / wordCount,
    hasStructure: /^\s*(?:[-*•]|\d+\.)\s/m.test(text) || /^#{1,6}\s/m.test(text),
  };
}

/** Approximate English syllable count. Good enough for a readability index. */
export function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (clean.length === 0) return 0;
  if (clean.length <= 3) return 1;

  const trimmed = clean.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(groups?.length ?? 1, 1);
}

/**
 * Flesch Reading Ease, clamped to 0–100.
 *
 * The raw formula is unbounded in both directions; technical prose legitimately
 * scores below zero, so clamping is the right call for a display metric. Note
 * that a *high* Flesch score means simpler text — for developer documentation
 * mid-range is usually the target, so we score distance from an ideal band
 * rather than raw simplicity.
 */
export function fleschReadingEase(stats: TextStats): number {
  if (stats.words === 0) return 0;
  const raw =
    206.835 - 1.015 * stats.avgWordsPerSentence - 84.6 * stats.avgSyllablesPerWord;
  return Math.min(100, Math.max(0, raw));
}

function scoreReadability(text: string): CriterionScore {
  const stats = analyseText(text);

  if (stats.words < 5) {
    return {
      criterionId: 'readability',
      score: 0,
      rationale: 'Response is too short to assess readability.',
      confidence: 0.9,
    };
  }

  const flesch = fleschReadingEase(stats);

  // Target band 45–75: clear without being simplistic. Distance from the band
  // is penalised linearly in both directions.
  const distance = flesch < 45 ? 45 - flesch : flesch > 75 ? flesch - 75 : 0;
  let score = Math.max(0, 100 - distance * 1.6);

  // Structure genuinely aids scanning; reward it modestly.
  if (stats.hasStructure) score = Math.min(100, score + 6);

  // Very long sentences hurt comprehension regardless of the Flesch score.
  if (stats.avgWordsPerSentence > 30) score = Math.max(0, score - 12);

  return {
    criterionId: 'readability',
    score: round(score),
    rationale:
      `Flesch reading ease ${flesch.toFixed(0)}; ` +
      `${stats.avgWordsPerSentence.toFixed(1)} words/sentence, ` +
      `${stats.avgSyllablesPerWord.toFixed(2)} syllables/word` +
      (stats.hasStructure ? '; uses lists or headings.' : '; no structural formatting.'),
    confidence: 0.65,
  };
}

function scoreConciseness(text: string): CriterionScore {
  const stats = analyseText(text);

  if (stats.words === 0) {
    return {
      criterionId: 'conciseness',
      score: 0,
      rationale: 'Response is empty.',
      confidence: 1,
    };
  }

  // Information density: distinct vocabulary carries content, filler does not.
  const diversityScore = Math.min(100, stats.lexicalDiversity * 165);
  const fillerPenalty = Math.min(45, stats.fillerRatio * 900);

  // Length penalty only applies past ~400 words, and grows slowly. Long answers
  // are not inherently unconcise; padded ones are.
  const lengthPenalty = stats.words > 400 ? Math.min(25, (stats.words - 400) / 24) : 0;

  const score = Math.max(
    0,
    Math.min(100, diversityScore - fillerPenalty - lengthPenalty),
  );

  return {
    criterionId: 'conciseness',
    score: round(score),
    rationale:
      `${stats.words} words, lexical diversity ${(stats.lexicalDiversity * 100).toFixed(0)}%, ` +
      `filler ${(stats.fillerRatio * 100).toFixed(1)}%.`,
    confidence: 0.6,
  };
}

const HEURISTIC_SCORERS: Partial<Record<CriterionId, (text: string) => CriterionScore>> =
  {
    readability: scoreReadability,
    conciseness: scoreConciseness,
  };

/** Returns null when the criterion has no local implementation. */
export function scoreHeuristic(
  criterionId: CriterionId,
  text: string,
): CriterionScore | null {
  const scorer = HEURISTIC_SCORERS[criterionId];
  return scorer ? scorer(text) : null;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
