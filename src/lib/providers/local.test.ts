import { describe, expect, it } from 'vitest';
import {
  LocalProvider,
  generateLocalResponse,
  hashString,
  seededRandom,
} from '@/lib/providers/local';
import { readSse } from '@/lib/providers/openrouter';
import { requireModel } from '@/lib/models/catalog';
import { DEFAULT_COMPLETION_PARAMS, type CompletionRequest } from '@/lib/core/types';

const request = (
  modelId: string,
  content = 'Explain database locking.',
): CompletionRequest => ({
  modelId,
  messages: [{ role: 'user', content }],
  params: { ...DEFAULT_COMPLETION_PARAMS, maxTokens: 512 },
});

describe('seeded randomness', () => {
  it('hashes deterministically', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });

  it('produces a repeatable sequence for a given seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const first = [a(), a(), a()];
    const second = [b(), b(), b()];
    expect(first).toEqual(second);
  });

  it('produces different sequences for different seeds', () => {
    expect(seededRandom(1)()).not.toBe(seededRandom(2)());
  });

  it('stays within the unit interval', () => {
    const rand = seededRandom(7);
    for (let i = 0; i < 200; i++) {
      const value = rand();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('generateLocalResponse', () => {
  it('is a pure function of model and prompt', () => {
    const model = requireModel('openai/gpt-4o-mini');
    const first = generateLocalResponse(model, request('openai/gpt-4o-mini'));
    const second = generateLocalResponse(model, request('openai/gpt-4o-mini'));
    expect(first).toBe(second);
  });

  it('differs across models for the same prompt', () => {
    const a = generateLocalResponse(
      requireModel('openai/gpt-4o-mini'),
      request('openai/gpt-4o-mini'),
    );
    const b = generateLocalResponse(
      requireModel('anthropic/claude-opus-4'),
      request('anthropic/claude-opus-4'),
    );
    expect(a).not.toBe(b);
  });

  it('differs across prompts for the same model', () => {
    const model = requireModel('openai/gpt-4o-mini');
    const a = generateLocalResponse(model, request('openai/gpt-4o-mini', 'question one'));
    const b = generateLocalResponse(model, request('openai/gpt-4o-mini', 'question two'));
    expect(a).not.toBe(b);
  });

  it('echoes the prompt so the response is visibly related to it', () => {
    const model = requireModel('openai/gpt-4o-mini');
    const response = generateLocalResponse(
      model,
      request('openai/gpt-4o-mini', 'What is CRDT?'),
    );
    expect(response).toContain('CRDT');
  });

  it('respects the max-token budget', () => {
    const model = requireModel('anthropic/claude-opus-4');
    const response = generateLocalResponse(model, {
      ...request('anthropic/claude-opus-4'),
      params: { ...DEFAULT_COMPLETION_PARAMS, maxTokens: 16 },
    });
    expect(response.length).toBeLessThanOrEqual(16 * 4 + 1);
  });

  it('handles an empty prompt without throwing', () => {
    const model = requireModel('openai/gpt-4o-mini');
    expect(() =>
      generateLocalResponse(model, request('openai/gpt-4o-mini', '')),
    ).not.toThrow();
  });
});

describe('LocalProvider', () => {
  const provider = new LocalProvider({ simulateLatency: false });

  it('reports itself as always configured', () => {
    expect(provider.isConfigured()).toBe(true);
  });

  it('returns a complete result with usage and cost', async () => {
    const result = await provider.complete(request('openai/gpt-4o-mini'));

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.finishReason).toBe('stop');
    expect(result.usage.totalTokens).toBe(
      result.usage.inputTokens + result.usage.outputTokens,
    );
    expect(result.cost.totalCostUsd).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  it('marks its output as simulated in the resolved model name', () => {
    // Anything downstream inspecting provenance must be able to tell.
    return provider.complete(request('openai/gpt-4o-mini')).then((result) => {
      expect(result.resolvedModel).toContain('local-sim');
    });
  });

  it('models a faster provider as genuinely faster', async () => {
    const groq = await provider.complete(request('groq/llama-3.1-8b-instant'));
    const deepseek = await provider.complete(request('deepseek/deepseek-r1'));
    expect(groq.timeToFirstTokenMs!).toBeLessThan(deepseek.timeToFirstTokenMs!);
  });

  it('rejects an unknown model', async () => {
    await expect(provider.complete(request('nope/does-not-exist'))).rejects.toThrow(
      /Unknown model/,
    );
  });

  it('streams deltas that reconstruct the final content', async () => {
    const events = [];
    for await (const event of provider.stream(request('openai/gpt-4o-mini'))) {
      events.push(event);
    }

    expect(events[0]?.type).toBe('start');
    expect(events.at(-1)?.type).toBe('done');

    const assembled = events
      .filter((e) => e.type === 'delta')
      .map((e) => (e.type === 'delta' ? e.text : ''))
      .join('');

    const done = events.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.result.content).toBe(assembled);
      expect(done.result.usage.outputTokens).toBeGreaterThan(0);
    }
  });

  it('stops streaming when the signal aborts', async () => {
    const controller = new AbortController();
    const events = [];

    for await (const event of provider.stream({
      ...request('openai/gpt-4o-mini'),
      signal: controller.signal,
    })) {
      events.push(event);
      if (events.length === 3) controller.abort();
    }

    const done = events.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.result.finishReason).toBe('aborted');
    }
  });
});

describe('readSse', () => {
  const stream = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });

  it('extracts data payloads from complete frames', async () => {
    const out = [];
    for await (const data of readSse(stream(['data: one\n\ndata: two\n\n'])))
      out.push(data);
    expect(out).toEqual(['one', 'two']);
  });

  it('reassembles a frame split across network chunks', async () => {
    // The case that silently drops tokens if partial lines are not buffered.
    const out = [];
    for await (const data of readSse(stream(['data: hel', 'lo\n\n']))) out.push(data);
    expect(out).toEqual(['hello']);
  });

  it('ignores non-data lines such as comments and keep-alives', async () => {
    const out = [];
    for await (const data of readSse(stream([': keep-alive\n\ndata: real\n\n'])))
      out.push(data);
    expect(out).toEqual(['real']);
  });

  it('yields the terminator so callers can stop', async () => {
    const out = [];
    for await (const data of readSse(stream(['data: [DONE]\n\n']))) out.push(data);
    expect(out).toEqual(['[DONE]']);
  });
});
