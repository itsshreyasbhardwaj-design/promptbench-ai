import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',

  // Serial, single-worker execution is a correctness requirement here, not a
  // performance compromise. In local mode the whole suite shares one in-memory
  // workspace, so parallel specs would mutate each other's state — a test that
  // creates a prompt suppresses the demo seed a later test asserts on.
  // Ordering the run makes that shared state deterministic.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Chromium runs the whole suite, including everything that mutates state.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },

    // Mobile runs only the read-only layout and navigation checks, tagged
    // @mobile. Both projects share one server and one in-memory workspace, so
    // replaying the state-mutating specs here would not test anything the
    // desktop project has not already covered — it would just have the two
    // projects corrupt each other's fixtures.
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],

  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      // E2E always runs against the deterministic local driver so runs are
      // reproducible, offline, and free.
      PROMPTBENCH_DRIVER: 'local',
      NEXT_PUBLIC_DEMO_MODE: 'true',
    },
  },
});
