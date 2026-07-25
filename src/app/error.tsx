'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Route error boundary.
 *
 * Shows the error's message rather than a generic apology, because the message
 * is usually what tells a developer what to fix. `digest` is included so a
 * production error can be correlated with the server log entry.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('[promptbench] route error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-5 py-16">
      <div className="max-w-md text-center">
        <p className="eyebrow mb-3">Something broke</p>
        <h1 className="text-ink text-xl font-semibold tracking-tight">
          This page could not be rendered
        </h1>
        <p className="text-ink-subtle mt-3 text-[13px] leading-relaxed">
          {error.message || 'An unexpected error occurred.'}
        </p>

        {error.digest ? (
          <p className="text-ink-faint mt-3 font-mono text-[11px]">
            Reference: {error.digest}
          </p>
        ) : null}

        <div className="mt-6 flex justify-center gap-2">
          <Button variant="primary" size="sm" onClick={reset}>
            <RefreshCw />
            Try again
          </Button>
          <Button asChild variant="secondary" size="sm">
            <a href="/dashboard">Back to dashboard</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
