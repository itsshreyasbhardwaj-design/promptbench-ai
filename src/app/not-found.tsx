import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-5 py-16">
      <div className="max-w-md text-center">
        <p className="eyebrow mb-3">404</p>
        <h1 className="text-ink text-xl font-semibold tracking-tight">
          There is nothing at this address
        </h1>
        <p className="text-ink-subtle mt-3 text-[13px] leading-relaxed">
          The prompt, run or dataset you are looking for may have been deleted, or the
          link may be wrong.
        </p>

        <div className="mt-6 flex justify-center gap-2">
          <Button asChild variant="primary" size="sm">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href="/playground">Open the playground</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
