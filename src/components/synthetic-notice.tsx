import { AlertTriangle } from 'lucide-react';
import { runtimeCapabilities, serverEnv } from '@/lib/env';

/**
 * Synthetic data disclosure.
 *
 * When the local driver is serving responses, every screen that shows a score,
 * a cost or a latency figure must say so. These numbers look exactly like real
 * benchmark results and would be trivially mistaken for them — an unlabelled
 * simulated leaderboard is actively misleading, so this is not optional
 * decoration.
 */
export function SyntheticNotice() {
  if (runtimeCapabilities(serverEnv()).liveModels) return null;

  return (
    <div
      role="note"
      className="border-warn/30 bg-warn/[0.07] flex items-start gap-3 rounded-lg border px-4 py-3"
    >
      <AlertTriangle className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="text-[13px] leading-relaxed">
        <p className="text-ink font-medium">Synthetic data</p>
        <p className="text-ink-subtle mt-0.5">
          Responses come from the deterministic local driver, not real models. Scores,
          costs and latencies are illustrative and must not be cited as a benchmark. Set{' '}
          <code className="bg-surface-raised text-ink-muted rounded px-1 py-0.5 font-mono text-[11px]">
            OPENROUTER_API_KEY
          </code>{' '}
          to run against live models.
        </p>
      </div>
    </div>
  );
}
