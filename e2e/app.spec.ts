import { expect, test } from '@playwright/test';

test.describe('landing page', () => {
  test('states the value proposition and links into the app', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Stop guessing which model',
    );
    await expect(page.getByRole('link', { name: /try the playground/i })).toBeVisible();

    await page.getByRole('link', { name: 'Open app' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('has exactly one h1 @mobile', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });
});

test.describe('navigation', () => {
  const destinations = [
    { link: 'Dashboard', heading: 'Dashboard', url: /\/dashboard/ },
    { link: 'Playground', heading: 'Playground', url: /\/playground/ },
    { link: 'Prompts', heading: 'Prompts', url: /\/prompts/ },
    { link: 'Datasets', heading: 'Datasets', url: /\/datasets/ },
    { link: 'Run history', heading: 'Run history', url: /\/runs/ },
    { link: 'Analytics', heading: 'Analytics', url: /\/analytics/ },
    { link: 'Leaderboard', heading: 'Leaderboard', url: /\/leaderboard/ },
    { link: 'Settings', heading: 'Settings', url: /\/settings/ },
  ];

  for (const destination of destinations) {
    test(`reaches ${destination.link}`, async ({ page }) => {
      await page.goto('/dashboard');
      await page
        .getByRole('link', { name: destination.link, exact: true })
        .first()
        .click();

      await expect(page).toHaveURL(destination.url);
      await expect(
        page.getByRole('heading', { level: 1, name: destination.heading }),
      ).toBeVisible();
    });
  }

  test('marks the active destination for assistive tech', async ({ page }) => {
    await page.goto('/analytics');
    await expect(
      page.getByRole('link', { name: 'Analytics', exact: true }).first(),
    ).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('dashboard', () => {
  // Creates its own run rather than relying on the demo seed. Seeding is
  // suppressed once a workspace has any content of its own, so a test that
  // depended on it would pass or fail based on which specs ran first.
  test.beforeAll(async ({ request }) => {
    await request.post('/api/v1/benchmarks', {
      data: {
        name: 'Dashboard fixture',
        template: 'Summarise {{topic}}',
        modelIds: ['openai/gpt-4o-mini', 'groq/llama-3.1-8b-instant'],
        params: { temperature: 0.5, maxTokens: 128, topP: 1 },
        cases: [{ variables: { topic: 'consensus protocols' } }],
        evaluate: true,
        rubricId: 'fast-heuristic',
      },
    });
  });

  test('shows headline metrics and recent runs', async ({ page }) => {
    await page.goto('/dashboard');

    // Scope to the metrics region — "Avg latency" is also a column header in
    // the runs table below. Labels render uppercase via CSS, so the DOM text
    // stays title case.
    const metrics = page.getByRole('region', { name: 'Key metrics' });
    await expect(metrics.getByText('Completions', { exact: true })).toBeVisible();
    await expect(metrics.getByText('Spend', { exact: true })).toBeVisible();
    await expect(metrics.getByText('Avg latency', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent runs' })).toBeVisible();
  });

  test('discloses that the data is synthetic', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(
      page.getByRole('note').filter({ hasText: 'Synthetic data' }),
    ).toBeVisible();
  });

  test('opens a run from the dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('tbody tr a').first().click();

    await expect(page).toHaveURL(/\/runs\/run_/);
    await expect(page.getByRole('button', { name: /export report/i })).toBeVisible();
  });
});

test.describe('leaderboard', () => {
  test('ranks models with spread rails @mobile', async ({ page }) => {
    await page.goto('/leaderboard');

    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    // The signature component renders as an accessible image with its position.
    await expect(page.getByRole('img', { name: /score/i }).first()).toBeVisible();
  });
});

test.describe('prompts library', () => {
  test('lists seeded prompts and filters by search', async ({ page }) => {
    await page.goto('/prompts');

    await expect(page.getByRole('link', { name: 'Bug triage classifier' })).toBeVisible();

    await page.getByLabel('Search prompts').fill('SQL');
    await expect(
      page.getByRole('link', { name: 'SQL from natural language' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bug triage classifier' })).toHaveCount(
      0,
    );
  });

  test('filters by collection', async ({ page }) => {
    await page.goto('/prompts');
    await page.getByRole('button', { name: /^Support/ }).click();
    await expect(page.getByRole('link', { name: 'Support reply drafter' })).toBeVisible();
  });

  test('shows an actionable empty state when nothing matches', async ({ page }) => {
    await page.goto('/prompts');
    await page.getByLabel('Search prompts').fill('zzzzznomatch');

    await expect(page.getByText('No prompts match those filters')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
  });
});

test.describe('prompt versioning', () => {
  test('shows history and diffs two versions', async ({ page }) => {
    await page.goto('/prompts');
    await page.getByRole('link', { name: 'Bug triage classifier' }).click();

    await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
    // The seeded prompt has two versions so the diff has something to show.
    // Scope to the badge — "current" also appears in the "Current template" heading.
    await expect(page.getByText('current', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Compare' }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByText('unchanged')).toBeVisible();
  });

  test('restores an earlier version by appending a new one', async ({ page }) => {
    await page.goto('/prompts');
    await page.getByRole('link', { name: 'Bug triage classifier' }).click();

    // Asserts the behaviour, not an absolute version number: each run appends a
    // version and CI retries against the same server, so hard-coding "v3" fails
    // on the second attempt.
    const restore = page.getByRole('button', { name: 'Restore' });
    await expect(restore.first()).toBeVisible();
    await restore.first().click();

    // Toasts stack across runs, so scope to the newest.
    await expect(page.getByText('Rolled back').last()).toBeVisible();

    // History is never rewritten: the rollback appears as its own timeline
    // entry rather than replacing what came before.
    await expect(page.getByText(/Rolled back to v\d+/).first()).toBeVisible();
  });
});

test.describe('accessibility and responsiveness', () => {
  test('exposes a skip link as the first tab stop @mobile', async ({ page }) => {
    await page.goto('/dashboard');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });

  test('does not scroll the body horizontally on mobile @mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/dashboard');

    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });

  test('offers mobile navigation when the rail is hidden @mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/dashboard');
    await expect(page.getByRole('navigation', { name: 'Main' }).last()).toBeVisible();
  });

  test('toggles between dark and light themes and remembers the choice', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    const root = page.locator('html');

    // The initial theme follows the OS preference, which varies by machine and
    // CI runner, so assert the transition rather than a fixed starting value.
    const initial = await root.getAttribute('data-theme');
    const opposite = initial === 'dark' ? 'light' : 'dark';

    await page
      .getByRole('button', { name: new RegExp(`switch to ${opposite}`, 'i') })
      .click();
    await expect(root).toHaveAttribute('data-theme', opposite);

    await page.reload();
    await expect(root).toHaveAttribute('data-theme', opposite);
  });
});

test.describe('errors', () => {
  test('renders a helpful 404 for an unknown route', async ({ page }) => {
    const response = await page.goto('/does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByText('There is nothing at this address')).toBeVisible();
  });

  test('renders a 404 for an unknown prompt id', async ({ page }) => {
    await page.goto('/prompts/prompt_doesnotexist0000');
    await expect(page.getByText('There is nothing at this address')).toBeVisible();
  });
});

test.describe('public API', () => {
  test('health reports mode and capabilities', async ({ request }) => {
    const response = await request.get('/api/v1/health');
    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.mode).toBe('local');
  });

  test('models returns the catalog', async ({ request }) => {
    const body = await (await request.get('/api/v1/models')).json();
    expect(body.data.models.length).toBeGreaterThan(10);
  });

  test('rejects a malformed benchmark request with a typed error', async ({
    request,
  }) => {
    const response = await request.post('/api/v1/benchmarks', {
      data: { template: '', modelIds: [] },
    });

    expect(response.status()).toBe(422);
    expect((await response.json()).error.code).toBe('validation_failed');
  });

  test('streams NDJSON from the compare endpoint', async ({ request }) => {
    const response = await request.post('/api/v1/compare', {
      data: {
        template: 'Say hello.',
        systemPrompt: '',
        variables: {},
        modelIds: ['groq/llama-3.1-8b-instant'],
        params: { temperature: 0.5, maxTokens: 64, topP: 1 },
      },
    });

    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('application/x-ndjson');

    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(events[0].type).toBe('start');
    expect(events.at(-1).type).toBe('done');
    expect(events.at(-1).result.usage.totalTokens).toBeGreaterThan(0);
  });
});
