import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/overlays';
import { clientEnv } from '@/lib/env';
import './globals.css';

/**
 * Instrument Sans carries the interface; JetBrains Mono carries every number.
 * Both are self-hosted by `next/font`, so there is no render-blocking request
 * to a font CDN and no layout shift when the face swaps in.
 */
const sans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(clientEnv.NEXT_PUBLIC_APP_URL),
  title: {
    default: 'PromptBench AI — LLM evaluation and benchmarking',
    template: '%s · PromptBench AI',
  },
  description:
    'Compare language models side by side on the same prompt. Measure quality, ' +
    'cost and latency, version your prompts, and export the evidence.',
  keywords: [
    'LLM evaluation',
    'model benchmarking',
    'prompt engineering',
    'AI observability',
    'OpenRouter',
  ],
  authors: [{ name: 'PromptBench contributors' }],
  openGraph: {
    type: 'website',
    title: 'PromptBench AI',
    description:
      'Compare language models side by side. Measure quality, cost and latency.',
    siteName: 'PromptBench AI',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PromptBench AI',
    description:
      'Compare language models side by side. Measure quality, cost and latency.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0d0e14' },
    { media: '(prefers-color-scheme: light)', color: '#fbfbfd' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} antialiased`}>
        <ThemeProvider>
          <TooltipProvider>
            {/* Keyboard users land here first and can jump past the nav. */}
            <a
              href="#main"
              className="focus:bg-signal focus:text-signal-ink sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
            >
              Skip to content
            </a>
            {children}
            <Toaster
              position="bottom-right"
              toastOptions={{
                classNames: {
                  toast: 'glass !rounded-lg !border !text-ink !text-[13px] !shadow-xl',
                  description: '!text-ink-subtle',
                },
              }}
            />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
