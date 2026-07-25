import type {
  CompletionRequest,
  CompletionResult,
  CompletionStreamEvent,
  ModelDescriptor,
  Provider,
} from '@/lib/core/types';
import {
  calculateCost,
  estimateMessagesTokens,
  estimateTokens,
  makeUsage,
} from '@/lib/models/cost';
import { requireModel } from '@/lib/models/catalog';

/**
 * Deterministic local driver.
 *
 * This is a **simulator**, not a model. It exists so that the entire product —
 * playground, streaming comparison, evaluation, analytics, reports, E2E tests —
 * is exercisable with no credentials, no network and no spend, and so that CI
 * assertions are stable rather than flaky against a live model.
 *
 * Output is a pure function of `(modelId, messages, params)`, so the same run
 * always produces the same text, token counts, latency and cost. Every surface
 * that renders local-driver output labels it as synthetic; see
 * `SyntheticDataBanner`. It must never be presented as a real benchmark.
 *
 * The per-model profiles below are *characterisations*, not measurements: they
 * encode published context/pricing tiers into plausible speed and verbosity so
 * the charts show meaningful spread instead of flat lines.
 */

interface ModelProfile {
  /** Simulated tokens per second. */
  tokensPerSecond: number;
  /** Simulated time to first token, milliseconds. */
  ttftMs: number;
  /** Multiplier applied to the baseline response length. */
  verbosity: number;
  /** Drives the tone and depth of the generated text, 0–1. */
  sophistication: number;
}

const DEFAULT_PROFILE: ModelProfile = {
  tokensPerSecond: 60,
  ttftMs: 420,
  verbosity: 1,
  sophistication: 0.6,
};

/**
 * Speed and verbosity characteristics keyed by provider, refined per model by
 * price tier. Groq is fastest by architecture; frontier tiers are slower and
 * more verbose; small models are fast and terse.
 */
const PROVIDER_PROFILES: Record<string, Partial<ModelProfile>> = {
  groq: { tokensPerSecond: 480, ttftMs: 110 },
  openai: { tokensPerSecond: 95, ttftMs: 380 },
  anthropic: { tokensPerSecond: 78, ttftMs: 450 },
  google: { tokensPerSecond: 130, ttftMs: 300 },
  deepseek: { tokensPerSecond: 42, ttftMs: 700 },
  mistral: { tokensPerSecond: 110, ttftMs: 260 },
  meta: { tokensPerSecond: 88, ttftMs: 340 },
  qwen: { tokensPerSecond: 96, ttftMs: 320 },
  cohere: { tokensPerSecond: 102, ttftMs: 290 },
};

function profileFor(model: ModelDescriptor): ModelProfile {
  const base = { ...DEFAULT_PROFILE, ...PROVIDER_PROFILES[model.provider] };
  // Price is a decent proxy for capability tier; scale depth and verbosity by it.
  const priceTier = Math.log10(Math.max(model.pricing.outputPerMillion, 0.05) + 1);
  return {
    ...base,
    verbosity: clamp(0.65 + priceTier * 0.55, 0.6, 1.9),
    sophistication: clamp(0.35 + priceTier * 0.5, 0.3, 0.98),
  };
}

/**
 * Small, fast, well-distributed string hash (FNV-1a) used to seed the PRNG.
 * Determinism matters more than cryptographic quality here.
 */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic PRNG (mulberry32). Same seed always yields the same sequence. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const OPENERS = [
  'Here is a structured take on that.',
  'Short answer first, then the reasoning.',
  'Let me work through this step by step.',
  'There are a few distinct considerations here.',
  'The core of this comes down to three things.',
];

const CONNECTORS = [
  'The important nuance is that trade-offs shift with scale.',
  'In practice the constraint that binds first is usually operational, not technical.',
  'It is worth separating what is true in principle from what holds under load.',
  'The failure mode to watch for is optimising the measurable at the expense of the meaningful.',
  'Most of the disagreement here dissolves once the success criteria are made explicit.',
  'A useful heuristic is to prefer the reversible option when information is incomplete.',
];

const CLOSERS = [
  'If you share the constraints you are working under, this can be narrowed considerably.',
  'The recommendation above assumes a typical production setting; adjust for your risk tolerance.',
  'Worth validating against a small sample before committing to the approach.',
  'That said, the second option becomes clearly better past roughly ten thousand requests a day.',
];

/**
 * Builds a response that is deterministic but visibly shaped by the prompt, so
 * side-by-side comparison and the evaluation engine both have real signal.
 */
export function generateLocalResponse(
  model: ModelDescriptor,
  request: CompletionRequest,
): string {
  const profile = profileFor(model);
  const prompt = request.messages.map((m) => m.content).join('\n');
  const seed = hashString(`${model.id}::${prompt}::${request.params.temperature}`);
  const rand = seededRandom(seed);

  const topic = extractTopic(prompt);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;

  const paragraphs: string[] = [];
  paragraphs.push(`${pick(OPENERS)} ${topic}`);

  const bodyCount = Math.max(1, Math.round(2 * profile.verbosity));
  for (let i = 0; i < bodyCount; i++) {
    paragraphs.push(pick(CONNECTORS));
  }

  // Higher-sophistication profiles produce an explicit structured breakdown.
  if (profile.sophistication > 0.55) {
    const bullets = Math.round(2 + profile.sophistication * 2);
    const items = Array.from(
      { length: bullets },
      (_, i) => `${i + 1}. ${pick(CONNECTORS)}`,
    );
    paragraphs.push(items.join('\n'));
  }

  paragraphs.push(pick(CLOSERS));

  const body = paragraphs.join('\n\n');
  const maxChars = request.params.maxTokens * 4;
  return body.length > maxChars ? `${body.slice(0, maxChars).trimEnd()}…` : body;
}

/** Pulls a short subject phrase out of the prompt to anchor the response. */
function extractTopic(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'The request did not contain a question.';
  const firstSentence = cleaned.split(/(?<=[.?!])\s/)[0] ?? cleaned;
  const snippet = firstSentence.slice(0, 160);
  return `Regarding "${snippet}${firstSentence.length > 160 ? '…' : ''}" —`;
}

export class LocalProvider implements Provider {
  readonly id = 'openrouter' as const;
  readonly label = 'Local (deterministic)';

  /** When false, streaming resolves instantly instead of pacing deltas. */
  private readonly simulateLatency: boolean;

  constructor(options?: { simulateLatency?: boolean }) {
    // Never sleep in unit tests; pacing is only useful for a human watching.
    this.simulateLatency = options?.simulateLatency ?? process.env.NODE_ENV !== 'test';
  }

  isConfigured(): boolean {
    return true;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const model = requireModel(request.modelId);
    const profile = profileFor(model);
    const content = generateLocalResponse(model, request);

    const outputTokens = estimateTokens(content);
    const usage = makeUsage(estimateMessagesTokens(request.messages), outputTokens);
    const latencyMs = Math.round(
      profile.ttftMs + (outputTokens / profile.tokensPerSecond) * 1000,
    );

    if (this.simulateLatency) await sleep(Math.min(latencyMs, 2_000), request.signal);
    if (request.signal?.aborted) {
      return abortedResult(request.modelId, model.provider, latencyMs);
    }

    return {
      modelId: request.modelId,
      provider: model.provider,
      resolvedModel: `${request.modelId}@local-sim`,
      content,
      usage,
      cost: calculateCost(model, usage),
      latencyMs,
      timeToFirstTokenMs: Math.round(profile.ttftMs),
      finishReason: 'stop',
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<CompletionStreamEvent> {
    const model = requireModel(request.modelId);
    const profile = profileFor(model);

    yield { type: 'start', modelId: request.modelId, provider: model.provider };

    const content = generateLocalResponse(model, request);
    // Split on word boundaries so deltas look like real token chunks.
    const chunks = content.match(/\S+\s*/g) ?? [content];
    const msPerChunk = 1000 / profile.tokensPerSecond;

    if (this.simulateLatency) await sleep(profile.ttftMs, request.signal);

    let emitted = '';
    for (const chunk of chunks) {
      if (request.signal?.aborted) break;
      emitted += chunk;
      yield { type: 'delta', modelId: request.modelId, text: chunk };
      if (this.simulateLatency) await sleep(msPerChunk, request.signal);
    }

    const outputTokens = estimateTokens(emitted);
    const usage = makeUsage(estimateMessagesTokens(request.messages), outputTokens);
    const latencyMs = Math.round(
      profile.ttftMs + (outputTokens / profile.tokensPerSecond) * 1000,
    );

    yield {
      type: 'done',
      modelId: request.modelId,
      result: {
        modelId: request.modelId,
        provider: model.provider,
        resolvedModel: `${request.modelId}@local-sim`,
        content: emitted,
        usage,
        cost: calculateCost(model, usage),
        latencyMs,
        timeToFirstTokenMs: Math.round(profile.ttftMs),
        finishReason: request.signal?.aborted ? 'aborted' : 'stop',
      },
    };
  }
}

function abortedResult(
  modelId: string,
  provider: CompletionResult['provider'],
  latencyMs: number,
): CompletionResult {
  return {
    modelId,
    provider,
    resolvedModel: modelId,
    content: '',
    usage: makeUsage(0, 0),
    cost: { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 },
    latencyMs,
    timeToFirstTokenMs: null,
    finishReason: 'aborted',
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
