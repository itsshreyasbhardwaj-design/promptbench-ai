import type { ModelDescriptor, ProviderId } from '@/lib/core/types';

/**
 * The model catalog.
 *
 * Ids are OpenRouter slugs, which lets a single gateway credential reach every
 * provider below. Pricing is USD per million tokens as published by each
 * vendor; it is a snapshot, so treat cost figures as planning estimates rather
 * than billing truth. `CATALOG_VERSION` is surfaced in the UI and in exported
 * reports so a stale snapshot is always visible to the reader.
 *
 * Adding a model is a pure data change — no code anywhere needs to know it
 * exists. See `docs/adding-a-provider.md` for adding a whole new provider.
 */
export const CATALOG_VERSION = '2026-07-25';

export const MODEL_CATALOG: readonly ModelDescriptor[] = [
  // ── OpenAI ────────────────────────────────────────────────────────────────
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    version: '2024-11-20',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillion: 2.5, outputPerMillion: 10, cachedInputPerMillion: 1.25 },
    modalities: ['text', 'vision'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Balanced flagship multimodal model. Strong general-purpose default.',
    judgeCapable: true,
    releasedAt: '2024-11-20',
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o mini',
    provider: 'openai',
    version: '2024-07-18',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: {
      inputPerMillion: 0.15,
      outputPerMillion: 0.6,
      cachedInputPerMillion: 0.075,
    },
    modalities: ['text', 'vision'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Low-cost workhorse. Excellent price/performance for high volume.',
    judgeCapable: true,
    releasedAt: '2024-07-18',
  },
  {
    id: 'openai/o3-mini',
    name: 'o3-mini',
    provider: 'openai',
    version: '2025-01-31',
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    pricing: { inputPerMillion: 1.1, outputPerMillion: 4.4 },
    modalities: ['text'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Reasoning-tuned model. Trades latency for multi-step accuracy.',
    judgeCapable: true,
    releasedAt: '2025-01-31',
  },

  // ── Anthropic ─────────────────────────────────────────────────────────────
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    version: '2025-05-14',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    pricing: { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 },
    modalities: ['text', 'vision'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'High-throughput frontier model. Very strong at code and analysis.',
    judgeCapable: true,
    releasedAt: '2025-05-14',
  },
  {
    id: 'anthropic/claude-opus-4',
    name: 'Claude Opus 4',
    provider: 'anthropic',
    version: '2025-05-14',
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    pricing: { inputPerMillion: 15, outputPerMillion: 75, cachedInputPerMillion: 1.5 },
    modalities: ['text', 'vision'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Highest-capability Anthropic tier for long-horizon reasoning.',
    judgeCapable: true,
    releasedAt: '2025-05-14',
  },
  {
    id: 'anthropic/claude-3-5-haiku',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    version: '2024-10-22',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.8, outputPerMillion: 4, cachedInputPerMillion: 0.08 },
    modalities: ['text', 'vision'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Fastest Anthropic tier. Good for classification and extraction.',
    judgeCapable: false,
    releasedAt: '2024-10-22',
  },

  // ── Google ────────────────────────────────────────────────────────────────
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    version: '2025-03-25',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: { inputPerMillion: 1.25, outputPerMillion: 10 },
    modalities: ['text', 'vision', 'audio'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Million-token context. Best in class for whole-repo or long docs.',
    judgeCapable: true,
    releasedAt: '2025-03-25',
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    version: '2025-04-17',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: { inputPerMillion: 0.3, outputPerMillion: 2.5 },
    modalities: ['text', 'vision', 'audio'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Long context at low cost. Strong default for RAG pipelines.',
    judgeCapable: true,
    releasedAt: '2025-04-17',
  },

  // ── Groq ──────────────────────────────────────────────────────────────────
  {
    id: 'groq/llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B (Groq)',
    provider: 'groq',
    version: '3.3-70b',
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    pricing: { inputPerMillion: 0.59, outputPerMillion: 0.79 },
    modalities: ['text'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'LPU-accelerated inference. Sub-second responses at scale.',
    judgeCapable: true,
    releasedAt: '2024-12-06',
  },
  {
    id: 'groq/llama-3.1-8b-instant',
    name: 'Llama 3.1 8B Instant (Groq)',
    provider: 'groq',
    version: '3.1-8b',
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.05, outputPerMillion: 0.08 },
    modalities: ['text'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Extremely cheap and fast. Ideal latency-floor baseline.',
    judgeCapable: false,
    releasedAt: '2024-07-23',
  },

  // ── DeepSeek ──────────────────────────────────────────────────────────────
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'deepseek',
    version: 'v3',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    pricing: {
      inputPerMillion: 0.27,
      outputPerMillion: 1.1,
      cachedInputPerMillion: 0.07,
    },
    modalities: ['text'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Frontier-adjacent quality at a fraction of US-lab pricing.',
    judgeCapable: true,
    releasedAt: '2024-12-26',
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'deepseek',
    version: 'r1',
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    pricing: { inputPerMillion: 0.55, outputPerMillion: 2.19 },
    modalities: ['text'],
    supportsStreaming: true,
    supportsTools: false,
    supportsJsonMode: true,
    description: 'Open reasoning model that exposes its chain of thought.',
    judgeCapable: true,
    releasedAt: '2025-01-20',
  },

  // ── Mistral ───────────────────────────────────────────────────────────────
  {
    id: 'mistralai/mistral-large',
    name: 'Mistral Large',
    provider: 'mistral',
    version: '2411',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 2, outputPerMillion: 6 },
    modalities: ['text'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'European flagship. Strong multilingual and function calling.',
    judgeCapable: true,
    releasedAt: '2024-11-18',
  },
  {
    id: 'mistralai/mistral-small',
    name: 'Mistral Small 3',
    provider: 'mistral',
    version: '2501',
    contextWindow: 32_000,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.3 },
    modalities: ['text'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Compact Apache-2.0 model suited to self-hosting.',
    judgeCapable: false,
    releasedAt: '2025-01-30',
  },

  // ── Meta ──────────────────────────────────────────────────────────────────
  {
    id: 'meta-llama/llama-4-maverick',
    name: 'Llama 4 Maverick',
    provider: 'meta',
    version: '4-maverick',
    contextWindow: 1_048_576,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillion: 0.22, outputPerMillion: 0.88 },
    modalities: ['text', 'vision'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Open-weights MoE with very long context and low cost.',
    judgeCapable: true,
    releasedAt: '2025-04-05',
  },
  {
    id: 'meta-llama/llama-3.1-405b-instruct',
    name: 'Llama 3.1 405B',
    provider: 'meta',
    version: '3.1-405b',
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    pricing: { inputPerMillion: 0.8, outputPerMillion: 0.8 },
    modalities: ['text'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Largest openly licensed dense model. Reliable reasoning baseline.',
    judgeCapable: true,
    releasedAt: '2024-07-23',
  },

  // ── Qwen ──────────────────────────────────────────────────────────────────
  {
    id: 'qwen/qwen-2.5-72b-instruct',
    name: 'Qwen 2.5 72B',
    provider: 'qwen',
    version: '2.5-72b',
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.35, outputPerMillion: 0.4 },
    modalities: ['text'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Strong bilingual EN/ZH performance and solid coding ability.',
    judgeCapable: true,
    releasedAt: '2024-09-19',
  },
  {
    id: 'qwen/qwen-2.5-coder-32b-instruct',
    name: 'Qwen 2.5 Coder 32B',
    provider: 'qwen',
    version: '2.5-coder-32b',
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    pricing: { inputPerMillion: 0.07, outputPerMillion: 0.16 },
    modalities: ['text'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Code-specialised and unusually cheap. Great for code benchmarks.',
    judgeCapable: false,
    releasedAt: '2024-11-12',
  },

  // ── Cohere ────────────────────────────────────────────────────────────────
  {
    id: 'cohere/command-r-plus',
    name: 'Command R+',
    provider: 'cohere',
    version: '08-2024',
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
    modalities: ['text'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'RAG-optimised with native citation and grounding support.',
    judgeCapable: true,
    releasedAt: '2024-08-30',
  },
  {
    id: 'cohere/command-r',
    name: 'Command R',
    provider: 'cohere',
    version: '08-2024',
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    modalities: ['text'],
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonMode: true,
    description: 'Cheaper RAG tier for high-volume retrieval workloads.',
    judgeCapable: false,
    releasedAt: '2024-08-30',
  },
] as const;

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  groq: 'Groq',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  meta: 'Meta',
  qwen: 'Qwen',
  cohere: 'Cohere',
  openrouter: 'OpenRouter',
};

const byId = new Map(MODEL_CATALOG.map((m) => [m.id, m]));

export function getModel(id: string): ModelDescriptor | undefined {
  return byId.get(id);
}

/** Throws when the id is unknown. Use at trust boundaries after validation. */
export function requireModel(id: string): ModelDescriptor {
  const model = byId.get(id);
  if (!model) {
    throw new Error(
      `Unknown model "${id}". Known models: ${[...byId.keys()].join(', ')}`,
    );
  }
  return model;
}

export function listModels(filter?: {
  provider?: ProviderId;
  judgeCapable?: boolean;
  maxInputCost?: number;
  search?: string;
}): ModelDescriptor[] {
  let models = [...MODEL_CATALOG];
  if (filter?.provider) models = models.filter((m) => m.provider === filter.provider);
  if (filter?.judgeCapable !== undefined) {
    models = models.filter((m) => m.judgeCapable === filter.judgeCapable);
  }
  if (filter?.maxInputCost !== undefined) {
    const max = filter.maxInputCost;
    models = models.filter((m) => m.pricing.inputPerMillion <= max);
  }
  if (filter?.search) {
    const q = filter.search.toLowerCase();
    models = models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        PROVIDER_LABELS[m.provider].toLowerCase().includes(q),
    );
  }
  return models;
}

export function listProviders(): ProviderId[] {
  return [...new Set(MODEL_CATALOG.map((m) => m.provider))];
}

/** Sensible starting selection for a fresh playground session. */
export const DEFAULT_MODEL_SELECTION = [
  'openai/gpt-4o-mini',
  'anthropic/claude-3-5-haiku',
  'google/gemini-2.5-flash',
] as const;

export const DEFAULT_JUDGE_MODEL = 'openai/gpt-4o-mini';
