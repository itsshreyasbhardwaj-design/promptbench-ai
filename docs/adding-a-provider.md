# Adding a provider

Most of the time you do **not** need this. Every model in the catalog is reached
through OpenRouter, which exposes an OpenAI-compatible surface in front of all
ten vendors. To make a new model available, append a row to `MODEL_CATALOG` in
`src/lib/models/catalog.ts` and bump `CATALOG_VERSION` — nothing else changes.

You need a new provider only when the transport itself is different: a direct
vendor SDK, a self-hosted vLLM or Ollama endpoint, an internal inference proxy,
or a recorded fixture for testing.

## The interface

```ts
interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  isConfigured(): boolean;
  complete(request: CompletionRequest): Promise<CompletionResult>;
  stream(request: CompletionRequest): AsyncGenerator<CompletionStreamEvent>;
}
```

Four rules the rest of the system depends on:

1. **Always report usage and cost.** If the upstream omits token counts, fall
   back to `estimateTokens` rather than reporting zero — a zero cost is actively
   wrong and silently corrupts every aggregate downstream.
2. **`stream` must emit `start`, then `delta`s, then exactly one `done`.** The
   `done` event carries the authoritative `CompletionResult`. Emit `error`
   instead of throwing when the failure is specific to one model, so a
   comparison containing it still returns useful results for the others.
3. **Honour `request.signal`.** A user who navigates away should stop costing
   money.
4. **Do not throw raw errors across the boundary.** Wrap them in `AppError` with
   an appropriate code so the API layer maps them to a sensible status.

## Example: a self-hosted endpoint

```ts
// src/lib/providers/vllm.ts
import { AppError } from '@/lib/core/errors';
import type {
  CompletionRequest,
  CompletionResult,
  CompletionStreamEvent,
  Provider,
} from '@/lib/core/types';
import {
  calculateCost,
  estimateMessagesTokens,
  estimateTokens,
  makeUsage,
} from '@/lib/models/cost';
import { requireModel } from '@/lib/models/catalog';

export class VllmProvider implements Provider {
  readonly id = 'openrouter' as const; // or a ProviderId you add to core/types
  readonly label = 'Self-hosted vLLM';

  constructor(private readonly baseUrl: string) {}

  isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const model = requireModel(request.modelId);
    const startedAt = performance.now();

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.modelId,
        messages: request.messages,
        temperature: request.params.temperature,
        max_tokens: request.params.maxTokens,
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });

    if (!response.ok) {
      throw new AppError('provider_error', `vLLM returned ${response.status}`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content ?? '';

    const usage = makeUsage(
      payload.usage?.prompt_tokens ?? estimateMessagesTokens(request.messages),
      payload.usage?.completion_tokens ?? estimateTokens(content),
    );

    return {
      modelId: request.modelId,
      provider: model.provider,
      resolvedModel: payload.model ?? request.modelId,
      content,
      usage,
      cost: calculateCost(model, usage),
      latencyMs: Math.round(performance.now() - startedAt),
      timeToFirstTokenMs: null,
      finishReason: 'stop',
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<CompletionStreamEvent> {
    const model = requireModel(request.modelId);
    yield { type: 'start', modelId: request.modelId, provider: model.provider };

    // Simplest correct implementation: fall back to a non-streaming call and
    // emit the whole body as one delta. Prefer real SSE parsing when the
    // endpoint supports it — `readSse` in providers/openrouter.ts is reusable.
    const result = await this.complete(request);
    yield { type: 'delta', modelId: request.modelId, text: result.content };
    yield { type: 'done', modelId: request.modelId, result };
  }
}
```

## Registering it

Providers are selected by an optional model-id prefix:

```ts
import { registerProvider } from '@/lib/providers/registry';
import { VllmProvider } from '@/lib/providers/vllm';

registerProvider('vllm', new VllmProvider(process.env.VLLM_URL!));
```

A model id of `vllm:llama-3.1-70b` now resolves to that provider. Model ids
without a registered prefix fall through to the default (OpenRouter when
configured, otherwise the local simulator).

## Testing it

Add a test file beside the provider. The suite runs with
`PROMPTBENCH_DRIVER=local`, so mock `fetch` rather than hitting a real endpoint:

```ts
it('falls back to estimated usage when the endpoint omits it', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] })),
  );

  const result = await new VllmProvider('http://localhost:8000').complete(request);
  expect(result.usage.outputTokens).toBeGreaterThan(0);
  expect(result.cost.totalCostUsd).toBeGreaterThan(0);
});
```
