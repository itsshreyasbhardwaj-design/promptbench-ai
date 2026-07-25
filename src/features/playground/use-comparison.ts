'use client';

import * as React from 'react';
import type {
  CompletionParams,
  CompletionResult,
  CompletionStreamEvent,
} from '@/lib/core/types';

/**
 * Streaming comparison state.
 *
 * The `/compare` endpoint multiplexes every model into one NDJSON stream, so
 * this hook demultiplexes by `modelId` and keeps one independent pane state per
 * model. That is what lets a fast model finish and show its cost while a slower
 * one is still writing.
 *
 * Deltas are buffered and flushed on an animation frame rather than triggering
 * a render each. A fast model emits hundreds of tokens per second across six
 * panes; re-rendering per token pegs the main thread and the text visibly
 * stutters. Batching to one flush per frame keeps it smooth without changing
 * what the user sees.
 */

export type PaneStatus = 'idle' | 'pending' | 'streaming' | 'done' | 'error';

export interface PaneState {
  modelId: string;
  status: PaneStatus;
  content: string;
  result: CompletionResult | null;
  error: string | null;
  retryable: boolean;
  /** Wall-clock ms since dispatch, used for a live timer before completion. */
  startedAt: number | null;
}

export interface ComparisonRequest {
  template: string;
  systemPrompt: string;
  variables: Record<string, string>;
  modelIds: string[];
  params: CompletionParams;
}

function initialPane(modelId: string): PaneState {
  return {
    modelId,
    status: 'idle',
    content: '',
    result: null,
    error: null,
    retryable: false,
    startedAt: null,
  };
}

export interface UseComparisonResult {
  panes: PaneState[];
  running: boolean;
  error: string | null;
  run: (request: ComparisonRequest) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export function useComparison(): UseComparisonResult {
  const [panes, setPanes] = React.useState<PaneState[]>([]);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const abortRef = React.useRef<AbortController | null>(null);
  const bufferRef = React.useRef(new Map<string, string>());
  const frameRef = React.useRef<number | null>(null);

  const flush = React.useCallback(() => {
    frameRef.current = null;
    const buffered = bufferRef.current;
    if (buffered.size === 0) return;

    const pending = new Map(buffered);
    buffered.clear();

    setPanes((current) =>
      current.map((pane) => {
        const text = pending.get(pane.modelId);
        if (!text) return pane;
        return {
          ...pane,
          status: pane.status === 'done' ? pane.status : 'streaming',
          content: pane.content + text,
        };
      }),
    );
  }, []);

  const scheduleFlush = React.useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(flush);
  }, [flush]);

  const applyEvent = React.useCallback(
    (event: CompletionStreamEvent) => {
      if (event.type === 'delta') {
        const buffered = bufferRef.current;
        buffered.set(event.modelId, (buffered.get(event.modelId) ?? '') + event.text);
        scheduleFlush();
        return;
      }

      // Terminal and lifecycle events must land in order relative to the text
      // they follow, so drain the buffer before applying them.
      flush();

      setPanes((current) =>
        current.map((pane) => {
          if (pane.modelId !== event.modelId) return pane;

          switch (event.type) {
            case 'start':
              return { ...pane, status: 'streaming', startedAt: Date.now() };
            case 'done':
              return {
                ...pane,
                status: 'done',
                result: event.result,
                // Trust the server's final content over the accumulated deltas;
                // they agree, but the server value is authoritative.
                content: event.result.content || pane.content,
              };
            case 'error':
              return {
                ...pane,
                status: 'error',
                error: event.message,
                retryable: event.retryable,
              };
            default:
              return pane;
          }
        }),
      );
    },
    [flush, scheduleFlush],
  );

  const run = React.useCallback(
    async (request: ComparisonRequest) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      bufferRef.current.clear();
      setError(null);
      setRunning(true);
      setPanes(
        request.modelIds.map((modelId) => ({
          ...initialPane(modelId),
          status: 'pending',
          startedAt: Date.now(),
        })),
      );

      try {
        const response = await fetch('/api/v1/compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.error?.message ??
              `Comparison failed with status ${response.status}.`,
          );
        }
        if (!response.body) throw new Error('The server returned an empty response.');

        for await (const event of readNdjson<CompletionStreamEvent>(response.body)) {
          applyEvent(event);
        }
      } catch (caught) {
        // An abort is a user action, not a failure.
        if (controller.signal.aborted) {
          setPanes((current) =>
            current.map((pane) =>
              pane.status === 'done' || pane.status === 'error'
                ? pane
                : { ...pane, status: 'error', error: 'Cancelled.', retryable: true },
            ),
          );
        } else {
          setError(caught instanceof Error ? caught.message : 'Comparison failed.');
          setPanes((current) =>
            current.map((pane) =>
              pane.status === 'done'
                ? pane
                : {
                    ...pane,
                    status: 'error',
                    error: caught instanceof Error ? caught.message : 'Request failed.',
                    retryable: true,
                  },
            ),
          );
        }
      } finally {
        flush();
        setRunning(false);
        abortRef.current = null;
      }
    },
    [applyEvent, flush],
  );

  const cancel = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = React.useCallback(() => {
    abortRef.current?.abort();
    bufferRef.current.clear();
    setPanes([]);
    setError(null);
    setRunning(false);
  }, []);

  // Abandon any in-flight request when the user navigates away, so the server
  // stops paying for tokens nobody will read.
  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return { panes, running, error, run, cancel, reset };
}

/**
 * Parses an NDJSON body into typed objects.
 *
 * Network chunks do not align to line boundaries, so partial lines are held
 * until their terminating newline arrives.
 */
export async function* readNdjson<T>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            yield JSON.parse(line) as T;
          } catch {
            // Skip a malformed frame rather than aborting the whole stream.
          }
        }
        newline = buffer.indexOf('\n');
      }
    }

    const remainder = buffer.trim();
    if (remainder) {
      try {
        yield JSON.parse(remainder) as T;
      } catch {
        // Trailing partial frame; nothing useful to recover.
      }
    }
  } finally {
    reader.releaseLock();
  }
}
