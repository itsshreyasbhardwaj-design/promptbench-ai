import { compareSchema } from '@/lib/api/schemas';
import { errorResponse } from '@/lib/api/handler';
import { requireSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/permissions';
import { enforceRateLimit, rateLimitIdentity } from '@/lib/api/rate-limit';
import { AppError } from '@/lib/core/errors';
import { requireModel } from '@/lib/models/catalog';
import { resolveProvider } from '@/lib/providers/registry';
import { renderTemplate } from '@/lib/prompts/template';
import { serverEnv } from '@/lib/env';
import type { ChatMessage, CompletionStreamEvent } from '@/lib/core/types';

/**
 * POST /api/v1/compare — stream one prompt against many models at once.
 *
 * Returns newline-delimited JSON rather than SSE. Every event carries its own
 * `modelId`, so a single multiplexed stream carries all models and the client
 * routes each delta to the right pane. NDJSON is used over SSE because the
 * client is `fetch`-based rather than `EventSource` (which cannot POST), and
 * NDJSON needs no frame encoding on either side.
 *
 * This route runs on the Node runtime: the provider layer uses `node:crypto`
 * for API-key hashing, and long streaming responses are not a good fit for
 * edge execution time limits.
 */
export const runtime = 'nodejs';
// Never cache: every request is a fresh model call.
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request.headers);
    requirePermission(session.role, 'benchmark:run');

    // Comparison fans out to N provider calls, so it gets a tighter budget than
    // the default read limit.
    await enforceRateLimit(rateLimitIdentity(request, session), {
      limit: Math.max(5, Math.floor(serverEnv().RATE_LIMIT_REQUESTS / 4)),
    });

    const raw = await request.json().catch(() => {
      throw new AppError('bad_request', 'Request body must be valid JSON.');
    });

    const parsed = compareSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('validation_failed', 'Request body failed validation.', {
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const input = parsed.data;
    const env = serverEnv();

    if (input.modelIds.length > env.MAX_MODELS_PER_RUN) {
      throw new AppError(
        'validation_failed',
        `A comparison may target at most ${env.MAX_MODELS_PER_RUN} models.`,
      );
    }

    // Validate every model before opening the stream, so a typo returns a clean
    // 422 instead of a half-written stream the client has to unpick.
    const models = input.modelIds.map((id) => requireModel(id));
    const rendered = renderTemplate(input.template, input.variables);

    const messages: ChatMessage[] = [
      ...(input.systemPrompt.trim()
        ? [{ role: 'system' as const, content: input.systemPrompt }]
        : []),
      { role: 'user' as const, content: rendered.text },
    ];

    const stream = multiplex(
      models.map((model) => model.id),
      messages,
      input.params,
      request.signal,
    );

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        // Stops nginx and similar proxies from buffering the stream, which
        // would defeat the entire point of streaming.
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Interleaves several provider streams into one NDJSON body.
 *
 * Each model is consumed by its own task writing into a shared queue, so a slow
 * model never blocks a fast one — the first token from Groq appears while
 * Claude is still thinking, which is the whole user-facing point of the feature.
 */
function multiplex(
  modelIds: string[],
  messages: ChatMessage[],
  params: Parameters<ReturnType<typeof resolveProvider>['stream']>[0]['params'],
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const emit = (event: CompletionStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The client hung up mid-write; stop trying to emit.
          closed = true;
        }
      };

      const tasks = modelIds.map(async (modelId) => {
        try {
          const provider = resolveProvider(modelId);
          for await (const event of provider.stream({
            modelId,
            messages,
            params,
            signal,
          })) {
            emit(event);
          }
        } catch (error) {
          // Contain the failure to this model. The rest of the comparison is
          // still useful, and the client renders an error card in that pane.
          emit({
            type: 'error',
            modelId,
            message: error instanceof Error ? error.message : 'Model request failed.',
            retryable: error instanceof AppError ? error.retryable : false,
          });
        }
      });

      await Promise.allSettled(tasks);

      if (!closed) {
        try {
          controller.close();
        } catch {
          // Already closed by client disconnect.
        }
      }
    },
  });
}
