import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],

      // Scoped to the logic unit tests can actually reach. Everything excluded
      // below is either covered elsewhere or cannot run in this environment,
      // and gating on it would make the number meaningless rather than strict.
      include: ['src/lib/**/*.ts'],
      exclude: [
        '**/*.test.ts',

        // Declarative table definitions — no behaviour to exercise.
        'src/lib/db/schema.ts',

        // Needs a live Postgres instance. Its behaviour is pinned by the shared
        // repository conformance suite, which both drivers are held to.
        'src/lib/db/postgres.ts',

        // Needs a live OpenRouter credential. Its pure parts (SSE framing,
        // usage normalisation) are tested directly; the transport is not.
        'src/lib/providers/openrouter.ts',

        // Browser-only hook, covered by the Playwright suite.
        'src/lib/utils/use-persisted-flag.ts',

        // Demo fixtures, exercised end to end by the E2E suite.
        'src/lib/demo/**',
      ],

      // Set just below the current figures so a real regression fails the
      // build, without the gate becoming a treadmill that invites contrived
      // tests written to move a number rather than to catch a defect.
      thresholds: {
        lines: 85,
        functions: 82,
        branches: 72,
        statements: 84,
      },
    },
  },
});
