import { describe, expect, it } from 'vitest';
import {
  calculateCost,
  estimateMessagesTokens,
  estimateTokens,
  formatLatency,
  formatTokens,
  formatUsd,
  makeUsage,
  projectRunCost,
} from '@/lib/models/cost';
import { requireModel } from '@/lib/models/catalog';
import type { ModelDescriptor } from '@/lib/core/types';

const model = (pricing: ModelDescriptor['pricing']): ModelDescriptor => ({
  id: 'test/model',
  name: 'Test',
  provider: 'openai',
  version: '1',
  contextWindow: 128_000,
  maxOutputTokens: 4_096,
  pricing,
  modalities: ['text'],
  supportsStreaming: true,
  supportsTools: true,
  supportsJsonMode: true,
  description: '',
  judgeCapable: false,
  releasedAt: '2025-01-01',
});

describe('calculateCost', () => {
  it('bills input and output at their separate per-million rates', () => {
    const cost = calculateCost(
      model({ inputPerMillion: 10, outputPerMillion: 30 }),
      makeUsage(1_000_000, 1_000_000),
    );

    expect(cost.inputCostUsd).toBe(10);
    expect(cost.outputCostUsd).toBe(30);
    expect(cost.totalCostUsd).toBe(40);
  });

  it('bills cached input at the cached rate when the model publishes one', () => {
    const cost = calculateCost(
      model({ inputPerMillion: 10, outputPerMillion: 30, cachedInputPerMillion: 1 }),
      makeUsage(1_000_000, 0, 800_000),
    );

    // 200k uncached at $10/M + 800k cached at $1/M
    expect(cost.inputCostUsd).toBeCloseTo(2 + 0.8, 8);
  });

  it('falls back to the standard input rate when no cached rate exists', () => {
    const cost = calculateCost(
      model({ inputPerMillion: 10, outputPerMillion: 30 }),
      makeUsage(1_000_000, 0, 500_000),
    );

    expect(cost.inputCostUsd).toBe(10);
  });

  it('never lets cached tokens exceed total input tokens', () => {
    // A provider reporting nonsense must not produce a negative uncached count,
    // which would silently credit the account.
    const cost = calculateCost(
      model({ inputPerMillion: 10, outputPerMillion: 30, cachedInputPerMillion: 0 }),
      makeUsage(1_000, 0, 999_999),
    );

    expect(cost.inputCostUsd).toBe(0);
    expect(cost.totalCostUsd).toBeGreaterThanOrEqual(0);
  });

  it('returns zero for empty usage', () => {
    const cost = calculateCost(
      model({ inputPerMillion: 10, outputPerMillion: 30 }),
      makeUsage(0, 0),
    );
    expect(cost.totalCostUsd).toBe(0);
  });

  it('keeps sub-cent precision for realistic single calls', () => {
    const cost = calculateCost(requireModel('openai/gpt-4o-mini'), makeUsage(1_200, 400));
    expect(cost.totalCostUsd).toBeGreaterThan(0);
    expect(cost.totalCostUsd).toBeLessThan(0.001);
  });
});

describe('estimateTokens', () => {
  it('returns zero for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('scales with text length', () => {
    const short = estimateTokens('Hello world');
    const long = estimateTokens('Hello world '.repeat(50));
    expect(long).toBeGreaterThan(short * 10);
  });

  it('lands within a reasonable band of real BPE output for English prose', () => {
    // ~50 words of prose tokenises to roughly 60-75 tokens on common BPEs.
    const text =
      'The quick brown fox jumps over the lazy dog. '.repeat(5) +
      'Pack my box with five dozen liquor jugs. '.repeat(2);
    const estimate = estimateTokens(text);
    expect(estimate).toBeGreaterThan(40);
    expect(estimate).toBeLessThan(140);
  });

  it('adds per-message framing overhead', () => {
    const single = estimateMessagesTokens([{ role: 'user', content: 'hi' }]);
    const split = estimateMessagesTokens([
      { role: 'system', content: 'h' },
      { role: 'user', content: 'i' },
    ]);
    expect(split).toBeGreaterThan(single);
  });
});

describe('projectRunCost', () => {
  it('multiplies per-case cost by the number of cases', () => {
    const models = [requireModel('openai/gpt-4o-mini')];
    const one = projectRunCost(models, 'a prompt', 1000, 1);
    const ten = projectRunCost(models, 'a prompt', 1000, 10);

    expect(ten.totalUsd).toBeCloseTo(one.perCaseUsd * 10, 8);
  });

  it('clamps projected output to each model own max', () => {
    // Claude 3.5 Haiku caps at 8192; asking for 100k must not inflate the
    // projection beyond what the model can actually emit.
    const projection = projectRunCost(
      [requireModel('anthropic/claude-3-5-haiku')],
      'x',
      100_000,
    );
    const capped = projectRunCost(
      [requireModel('anthropic/claude-3-5-haiku')],
      'x',
      8_192,
    );
    expect(projection.perCaseUsd).toBeCloseTo(capped.perCaseUsd, 8);
  });

  it('sums across every selected model', () => {
    const single = projectRunCost([requireModel('openai/gpt-4o-mini')], 'x', 500);
    const pair = projectRunCost(
      [requireModel('openai/gpt-4o-mini'), requireModel('openai/gpt-4o-mini')],
      'x',
      500,
    );
    expect(pair.perCaseUsd).toBeCloseTo(single.perCaseUsd * 2, 8);
  });
});

describe('formatters', () => {
  it('shows more decimal places for smaller amounts', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.000012)).toBe('$0.00001');
    expect(formatUsd(0.1234)).toBe('$0.1234');
    expect(formatUsd(12.5)).toBe('$12.50');
  });

  it('abbreviates large token counts', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1_500)).toBe('1.5k');
    expect(formatTokens(2_500_000)).toBe('2.50M');
  });

  it('switches from milliseconds to seconds at one second', () => {
    expect(formatLatency(450)).toBe('450ms');
    expect(formatLatency(1_500)).toBe('1.50s');
  });
});
