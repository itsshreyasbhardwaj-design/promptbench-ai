import type {
  ChatMessage,
  Criterion,
  CriterionId,
  CriterionScore,
} from '@/lib/core/types';
import { DEFAULT_COMPLETION_PARAMS } from '@/lib/core/types';
import { resolveProvider } from '@/lib/providers/registry';
import { hashString, seededRandom } from '@/lib/providers/local';
import { analyseText } from '@/lib/evaluation/heuristics';
import { usingLiveModels } from '@/lib/providers/registry';

/**
 * LLM-as-judge scoring.
 *
 * All criteria for one response are scored in a *single* judge call rather than
 * one call per criterion. That is a 6x cost reduction on the default rubric and
 * it also gives the judge the full picture, which measurably reduces the
 * inconsistency you get when scoring criteria in isolation.
 */

const JUDGE_SYSTEM_PROMPT = `You are a rigorous, calibrated evaluator of language model outputs.

You will be given the original prompt, a model's response, and a list of scoring criteria.
Score each criterion from 0 to 100 and justify each score in one sentence.

Calibration anchors — use the full range:
  0-20   unusable; fails the criterion outright
  21-40  significant deficiencies a user would immediately notice
  41-60  acceptable but clearly improvable
  61-80  good; minor issues only
  81-100 excellent; hard to improve without changing the task

Rules:
- Judge only what is present. Do not reward or penalise on assumed intent.
- Be decisive. Defaulting everything to 70-75 makes the evaluation worthless.
- Different criteria measure different things; scores should diverge.
- Return ONLY valid JSON matching the requested schema. No prose, no markdown fences.`;

interface JudgeVerdict {
  scores: Array<{ criterion: string; score: number; rationale: string }>;
}

export interface JudgeInput {
  prompt: string;
  response: string;
  criteria: Criterion[];
  judgeModelId: string;
  signal?: AbortSignal;
}

export function buildJudgeMessages(input: JudgeInput): ChatMessage[] {
  const criteriaBlock = input.criteria
    .map(
      (c) =>
        `- "${c.id}" (${c.label}): ${c.judgeGuidance ?? c.description}` +
        (c.inverted ? ' NOTE: this is a RISK score — higher means worse.' : ''),
    )
    .join('\n');

  const schema = `{"scores":[${input.criteria
    .map((c) => `{"criterion":"${c.id}","score":<0-100>,"rationale":"<one sentence>"}`)
    .join(',')}]}`;

  return [
    { role: 'system', content: JUDGE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '### Original prompt',
        truncate(input.prompt, 8_000),
        '',
        '### Model response',
        truncate(input.response, 12_000),
        '',
        '### Criteria',
        criteriaBlock,
        '',
        '### Required output shape',
        schema,
      ].join('\n'),
    },
  ];
}

/**
 * Extracts the verdict JSON from a judge response.
 *
 * Judges reliably wrap JSON in prose or fences despite instructions, so this
 * strips fences and falls back to locating the outermost balanced object.
 */
export function parseJudgeResponse(raw: string): JudgeVerdict | null {
  const withoutFences = raw.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();

  const candidates = [withoutFences, extractBalancedObject(withoutFences)].filter(
    (c): c is string => Boolean(c),
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as JudgeVerdict;
      if (Array.isArray(parsed?.scores)) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

function extractBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') inString = !inString;
    if (inString) continue;
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Scores every judge-backed criterion for one response.
 *
 * Returns scores in the same order as `input.criteria`. A criterion the judge
 * omitted or returned nonsense for falls back to a neutral 50 with explicit
 * low confidence, rather than silently dropping out of the weighted average.
 */
export async function runJudge(input: JudgeInput): Promise<CriterionScore[]> {
  if (input.criteria.length === 0) return [];

  // Without live models a real judge call is impossible; produce a deterministic
  // stand-in so the whole evaluation pipeline still exercises end to end.
  if (!usingLiveModels()) {
    return simulateJudge(input);
  }

  const provider = resolveProvider(input.judgeModelId);
  const result = await provider.complete({
    modelId: input.judgeModelId,
    messages: buildJudgeMessages(input),
    params: {
      ...DEFAULT_COMPLETION_PARAMS,
      // Judging must be as reproducible as the provider allows.
      temperature: 0,
      maxTokens: 1_500,
      seed: 7,
    },
    ...(input.signal ? { signal: input.signal } : {}),
  });

  const verdict = parseJudgeResponse(result.content);
  if (!verdict) {
    return input.criteria.map((c) =>
      neutralScore(c, 'Judge returned unparseable output.'),
    );
  }

  const byId = new Map(verdict.scores.map((s) => [s.criterion, s]));

  return input.criteria.map((criterion) => {
    const entry = byId.get(criterion.id);
    if (!entry || typeof entry.score !== 'number' || !Number.isFinite(entry.score)) {
      return neutralScore(criterion, 'Judge did not score this criterion.');
    }

    const clamped = Math.min(100, Math.max(0, entry.score));
    return {
      criterionId: criterion.id,
      // Inverted criteria are risk measures; flip so higher is always better.
      score: criterion.inverted ? 100 - clamped : clamped,
      rationale: entry.rationale?.trim() || 'No rationale provided.',
      confidence: 0.85,
    };
  });
}

function neutralScore(criterion: Criterion, reason: string): CriterionScore {
  return {
    criterionId: criterion.id,
    score: 50,
    rationale: reason,
    confidence: 0.2,
  };
}

/**
 * Deterministic judge stand-in for local mode.
 *
 * Scores are derived from real, if shallow, properties of the response (length,
 * structure, lexical diversity) blended with a seeded per-criterion offset, so
 * that different models produce genuinely different and stable rankings. This
 * is clearly labelled as synthetic wherever it surfaces.
 */
function simulateJudge(input: JudgeInput): CriterionScore[] {
  const stats = analyseText(input.response);
  const rand = seededRandom(hashString(`${input.judgeModelId}::${input.response}`));

  // Shallow quality proxy in 0–1.
  const substance = Math.min(1, stats.words / 220);
  const density = Math.min(1, stats.lexicalDiversity * 1.8);
  const structure = stats.hasStructure ? 0.12 : 0;
  const base = 42 + (substance * 26 + density * 22 + structure * 100) * 0.85;

  return input.criteria.map((criterion) => {
    const jitter = (rand() - 0.5) * 22;
    const raw = Math.min(97, Math.max(12, base + jitter + criterionBias(criterion.id)));
    return {
      criterionId: criterion.id,
      score: Math.round(raw * 10) / 10,
      rationale:
        'Simulated score from the local driver — derived from response ' +
        'structure and density, not a real judge. Configure OPENROUTER_API_KEY ' +
        'for genuine evaluation.',
      confidence: 0.25,
    };
  });
}

/** Keeps simulated criteria from collapsing onto the same value. */
function criterionBias(id: CriterionId): number {
  const biases: Record<CriterionId, number> = {
    correctness: 2,
    helpfulness: 4,
    reasoning: -1,
    code_quality: -3,
    creativity: -5,
    hallucination_risk: 6,
    instruction_following: 3,
    safety: 12,
    conciseness: 0,
    readability: 1,
  };
  return biases[id];
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated]`;
}
