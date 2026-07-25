import { AppError } from '@/lib/core/errors';
import type {
  CompletionRequest,
  CompletionResult,
  CompletionStreamEvent,
  Provider,
  TokenUsage,
} from '@/lib/core/types';
import {
  calculateCost,
  estimateMessagesTokens,
  estimateTokens,
  makeUsage,
} from '@/lib/models/cost';
import { requireModel } from '@/lib/models/catalog';
import { serverEnv } from '@/lib/env';

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface OpenRouterChoice {
  message?: { content?: string | null };
  delta?: { content?: string | null };
  finish_reason?: string | null;
}

interface OpenRouterResponse {
  id?: string;
  model?: string;
  choices?: OpenRouterChoice[];
  usage?: OpenRouterUsage;
  error?: { message?: string; code?: number };
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/**
 * OpenRouter-backed provider.
 *
 * OpenRouter exposes an OpenAI-compatible surface in front of every vendor in
 * the catalog, which is why one adapter covers all ten. Anything vendor-shaped
 * (pricing, context windows, capability flags) lives in the catalog rather than
 * here, so this file stays a transport concern.
 */
export class OpenRouterProvider implements Provider {
  readonly id = 'openrouter' as const;
  readonly label = 'OpenRouter';

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options?: { apiKey?: string; baseUrl?: string; timeoutMs?: number }) {
    const env = serverEnv();
    this.apiKey = options?.apiKey ?? env.OPENROUTER_API_KEY;
    this.baseUrl = (options?.baseUrl ?? env.OPENROUTER_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = options?.timeoutMs ?? env.PROVIDER_TIMEOUT_MS;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private headers(): HeadersInit {
    if (!this.apiKey) {
      throw new AppError(
        'provider_unconfigured',
        'OPENROUTER_API_KEY is not set. Set it to route to live models, or run in local mode.',
      );
    }
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      // OpenRouter uses these for attribution on its public leaderboards.
      'HTTP-Referer': 'https://github.com/itsshreyasbhardwaj-design/promptbench-ai',
      'X-Title': 'PromptBench AI',
    };
  }

  private body(request: CompletionRequest, stream: boolean) {
    const model = requireModel(request.modelId);
    return JSON.stringify({
      model: request.modelId,
      messages: request.messages,
      temperature: request.params.temperature,
      max_tokens: Math.min(request.params.maxTokens, model.maxOutputTokens),
      top_p: request.params.topP,
      ...(request.params.seed !== undefined ? { seed: request.params.seed } : {}),
      ...(request.params.stopSequences?.length
        ? { stop: request.params.stopSequences }
        : {}),
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
    });
  }

  /**
   * Merges a caller-supplied abort signal with our own timeout so a hung
   * provider cannot pin a request open forever.
   */
  private withTimeout(signal?: AbortSignal): {
    signal: AbortSignal;
    cleanup: () => void;
  } {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('Provider request timed out')),
      this.timeoutMs,
    );
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      },
    };
  }

  private async request(request: CompletionRequest, stream: boolean): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { signal, cleanup } = this.withTimeout(request.signal);
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.headers(),
          body: this.body(request, stream),
          signal,
        });

        if (response.ok) {
          // Caller owns the body from here; only clear the timeout.
          cleanup();
          return response;
        }

        const detail = await safeReadError(response);
        if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
          cleanup();
          await backoff(attempt, response.headers.get('retry-after'));
          continue;
        }

        throw new AppError(
          response.status === 429 ? 'rate_limited' : 'provider_error',
          `OpenRouter returned ${response.status}: ${detail}`,
          { retryable: RETRYABLE_STATUSES.has(response.status) },
        );
      } catch (error) {
        cleanup();
        if (error instanceof AppError) throw error;
        if (request.signal?.aborted) {
          throw new AppError('bad_request', 'Request was cancelled.', {
            retryable: false,
          });
        }
        lastError = error;
        if (attempt < MAX_ATTEMPTS) {
          await backoff(attempt, null);
          continue;
        }
      }
    }

    throw new AppError(
      'provider_timeout',
      `OpenRouter did not respond after ${MAX_ATTEMPTS} attempts: ${
        lastError instanceof Error ? lastError.message : 'unknown error'
      }`,
      { cause: lastError },
    );
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const model = requireModel(request.modelId);
    const startedAt = performance.now();

    const response = await this.request(request, false);
    const payload = (await response.json()) as OpenRouterResponse;

    if (payload.error) {
      throw new AppError(
        'provider_error',
        payload.error.message ?? 'Unknown provider error',
      );
    }

    const content = payload.choices?.[0]?.message?.content ?? '';
    const usage = normaliseUsage(payload.usage, request, content);

    return {
      modelId: request.modelId,
      provider: model.provider,
      resolvedModel: payload.model ?? request.modelId,
      content,
      usage,
      cost: calculateCost(model, usage),
      latencyMs: Math.round(performance.now() - startedAt),
      timeToFirstTokenMs: null,
      finishReason: mapFinishReason(payload.choices?.[0]?.finish_reason),
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<CompletionStreamEvent> {
    const model = requireModel(request.modelId);
    const startedAt = performance.now();
    let firstTokenAt: number | null = null;
    let content = '';
    let finishReason: string | null = null;
    let reportedUsage: OpenRouterUsage | undefined;
    let resolvedModel = request.modelId;

    yield { type: 'start', modelId: request.modelId, provider: model.provider };

    const response = await this.request(request, true);
    if (!response.body) {
      throw new AppError('provider_error', 'OpenRouter returned an empty stream body.');
    }

    for await (const data of readSse(response.body)) {
      if (data === '[DONE]') break;

      let chunk: OpenRouterResponse;
      try {
        chunk = JSON.parse(data) as OpenRouterResponse;
      } catch {
        // A malformed keep-alive frame is not worth failing the whole stream.
        continue;
      }

      if (chunk.error) {
        yield {
          type: 'error',
          modelId: request.modelId,
          message: chunk.error.message ?? 'Provider stream error',
          retryable: true,
        };
        return;
      }

      if (chunk.model) resolvedModel = chunk.model;
      if (chunk.usage) reportedUsage = chunk.usage;

      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;

      const delta = choice?.delta?.content;
      if (delta) {
        firstTokenAt ??= performance.now();
        content += delta;
        yield { type: 'delta', modelId: request.modelId, text: delta };
      }
    }

    const usage = normaliseUsage(reportedUsage, request, content);

    yield {
      type: 'done',
      modelId: request.modelId,
      result: {
        modelId: request.modelId,
        provider: model.provider,
        resolvedModel,
        content,
        usage,
        cost: calculateCost(model, usage),
        latencyMs: Math.round(performance.now() - startedAt),
        timeToFirstTokenMs:
          firstTokenAt === null ? null : Math.round(firstTokenAt - startedAt),
        finishReason: mapFinishReason(finishReason),
      },
    };
  }
}

/**
 * Parses a `text/event-stream` body into its `data:` payloads.
 *
 * Chunk boundaries do not respect SSE frame boundaries, so partial lines are
 * buffered until a frame terminator arrives.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of frame.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            yield trimmed.slice(5).trim();
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function normaliseUsage(
  usage: OpenRouterUsage | undefined,
  request: CompletionRequest,
  content: string,
): TokenUsage {
  // Providers occasionally omit usage on streamed responses; fall back to an
  // estimate rather than reporting zero cost, which would be actively wrong.
  const inputTokens = usage?.prompt_tokens ?? estimateMessagesTokens(request.messages);
  const outputTokens = usage?.completion_tokens ?? estimateTokens(content);
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return makeUsage(inputTokens, outputTokens, cached);
}

function mapFinishReason(
  reason: string | null | undefined,
): CompletionResult['finishReason'] {
  switch (reason) {
    case 'stop':
    case 'end_turn':
      return 'stop';
    case 'length':
    case 'max_tokens':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'stop';
  }
}

async function safeReadError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      return parsed.error?.message ?? text.slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return response.statusText;
  }
}

/** Exponential backoff with full jitter, honouring `Retry-After` when present. */
async function backoff(attempt: number, retryAfter: string | null): Promise<void> {
  const headerMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
  const base = Number.isFinite(headerMs) ? headerMs : 2 ** attempt * 250;
  const delay = Math.min(base * (0.5 + Math.random() * 0.5), 10_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}
