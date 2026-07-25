import type { CostBreakdown, ModelDescriptor, TokenUsage } from '@/lib/core/types';

const TOKENS_PER_MILLION = 1_000_000;

/**
 * Computes spend for one completion.
 *
 * Cached input tokens are billed at the model's cached rate when it publishes
 * one, and at the normal input rate otherwise. Results are rounded to 8 decimal
 * places — enough to keep sub-cent per-call figures meaningful while avoiding
 * floating-point noise accumulating across thousands of aggregated rows.
 */
export function calculateCost(model: ModelDescriptor, usage: TokenUsage): CostBreakdown {
  const { pricing } = model;
  const cached = Math.min(Math.max(usage.cachedInputTokens, 0), usage.inputTokens);
  const uncached = usage.inputTokens - cached;

  const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion;

  const inputCostUsd =
    (uncached * pricing.inputPerMillion) / TOKENS_PER_MILLION +
    (cached * cachedRate) / TOKENS_PER_MILLION;

  const outputCostUsd =
    (usage.outputTokens * pricing.outputPerMillion) / TOKENS_PER_MILLION;

  return {
    inputCostUsd: round(inputCostUsd),
    outputCostUsd: round(outputCostUsd),
    totalCostUsd: round(inputCostUsd + outputCostUsd),
  };
}

function round(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

/**
 * Approximate token count for text.
 *
 * Real tokenisation is provider- and model-specific, and shipping a WASM BPE
 * tokenizer for ten vendors is not worth the bundle cost when providers return
 * exact usage on every response. This estimate exists for two narrow purposes:
 * pre-flight cost projection in the UI before a run, and usage accounting for
 * the local driver. It is deliberately conservative (biased slightly high) so
 * projections do not understate spend.
 *
 * The heuristic blends a character-ratio estimate with a word-count estimate,
 * which tracks real BPE output within roughly ±15% for English prose and code.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chars = text.length;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return Math.ceil(chars / 4);

  const byChars = chars / 3.8;
  const byWords = words * 1.35;
  return Math.max(1, Math.ceil((byChars + byWords) / 2));
}

export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string }>,
): number {
  // ~4 tokens of framing overhead per message across common chat templates.
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0 };
}

export function makeUsage(
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): TokenUsage {
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/**
 * Projects the cost of a run before executing it, so the UI can warn about an
 * expensive fan-out. Output tokens are unknowable ahead of time, so `maxTokens`
 * is used as the ceiling and the caller should present this as an upper bound.
 */
export function projectRunCost(
  models: ModelDescriptor[],
  promptText: string,
  maxOutputTokens: number,
  caseCount = 1,
): { perCaseUsd: number; totalUsd: number } {
  const inputTokens = estimateTokens(promptText);
  const perCaseUsd = models.reduce((sum, model) => {
    const usage = makeUsage(
      inputTokens,
      Math.min(maxOutputTokens, model.maxOutputTokens),
    );
    return sum + calculateCost(model, usage).totalCostUsd;
  }, 0);
  return { perCaseUsd: round(perCaseUsd), totalUsd: round(perCaseUsd * caseCount) };
}

/** Formats a USD amount with precision appropriate to its magnitude. */
export function formatUsd(value: number): string {
  if (value === 0) return '$0.00';
  if (Math.abs(value) < 0.01) return `$${value.toFixed(5)}`;
  if (Math.abs(value) < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatTokens(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function formatLatency(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(2)}s`;
}
