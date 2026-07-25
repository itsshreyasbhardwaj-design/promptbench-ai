import { expect, test } from '@playwright/test';

/**
 * End-to-end coverage of the critical path: author a prompt, fan it out across
 * models, watch responses stream, and save the result.
 *
 * Runs against the deterministic local driver (set in `playwright.config.ts`),
 * so assertions about content and ordering are stable and no test can spend
 * money on a live provider.
 */

test.describe('playground', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/playground');
  });

  test('warns that responses are synthetic', async ({ page }) => {
    // The disclosure is load-bearing: these figures look exactly like real
    // benchmark results and must never be mistaken for them.
    const notice = page.getByRole('note').filter({ hasText: 'Synthetic data' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('OPENROUTER_API_KEY');
  });

  test('starts with an empty result area and a disabled run button', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Nothing running yet' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /run comparison/i })).toBeDisabled();
  });

  test('streams a response from every selected model', async ({ page }) => {
    await page
      .getByLabel('Prompt', { exact: true })
      .fill('Explain the CAP theorem in two sentences.');

    const run = page.getByRole('button', { name: /run comparison/i });
    await expect(run).toBeEnabled();
    await run.click();

    // Three models are selected by default; each gets its own pane.
    const panes = page.getByRole('article', { name: /response from/i });
    await expect(panes).toHaveCount(3);

    // Every pane eventually reports completion with its measured cost.
    await expect(page.getByText('Done').first()).toBeVisible({ timeout: 30_000 });
    for (let i = 0; i < 3; i++) {
      await expect(panes.nth(i)).toContainText('CAP theorem', { timeout: 30_000 });
    }
  });

  test('reports latency, tokens and cost for each model', async ({ page }) => {
    await page.getByLabel('Prompt', { exact: true }).fill('Define idempotence.');
    await page.getByRole('button', { name: /run comparison/i }).click();

    // Metric labels render uppercase via CSS; the DOM text stays title case.
    const first = page.getByRole('article', { name: /response from/i }).first();
    await expect(first).toContainText('Latency', { timeout: 30_000 });
    await expect(first).toContainText('TTFT');
    await expect(first).toContainText('Tokens');
    await expect(first).toContainText('Cost');
  });

  test('exposes declared variables as inputs and substitutes them', async ({ page }) => {
    await page
      .getByLabel('Prompt', { exact: true })
      .fill('Translate {{phrase}} into French.');

    const variable = page.getByLabel('phrase');
    await expect(variable).toBeVisible();
    await variable.fill('good morning');

    await page.getByRole('button', { name: /run comparison/i }).click();
    await expect(
      page.getByRole('article', { name: /response from/i }).first(),
    ).toContainText('good morning', { timeout: 30_000 });
  });

  test('warns when a required variable has no value', async ({ page }) => {
    await page.getByLabel('Prompt', { exact: true }).fill('Summarise {{document}}');
    await page.getByRole('button', { name: /run comparison/i }).click();
    await expect(page.getByText(/will render empty/i)).toBeVisible();
  });

  test('projects the upper-bound cost before running', async ({ page }) => {
    await page.getByLabel('Prompt', { exact: true }).fill('A prompt that costs money.');
    await expect(page.getByText('Projected cost')).toBeVisible();
    await expect(page.getByText(/≤ \$/)).toBeVisible();
  });

  test('adds and removes models from the comparison', async ({ page }) => {
    await page.getByRole('button', { name: 'Add model' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Search models').fill('Mistral Large');
    await dialog
      .getByRole('button', { name: /Mistral Large/ })
      .first()
      .click();
    await dialog.getByRole('button', { name: 'Done' }).click();

    await expect(
      page.getByRole('button', { name: 'Remove Mistral Large' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Remove Mistral Large' }).click();
    await expect(page.getByRole('button', { name: 'Remove Mistral Large' })).toHaveCount(
      0,
    );
  });

  test('runs on Cmd+Enter', async ({ page }) => {
    const prompt = page.getByLabel('Prompt', { exact: true });
    await prompt.fill('Explain vector clocks.');
    await prompt.press('ControlOrMeta+Enter');

    await expect(
      page.getByRole('article', { name: /response from/i }).first(),
    ).toBeVisible();
  });

  test('clears results on reset', async ({ page }) => {
    await page.getByLabel('Prompt', { exact: true }).fill('Anything at all.');
    await page.getByRole('button', { name: /run comparison/i }).click();
    await expect(page.getByText('Done').first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Clear results' }).click();
    await expect(
      page.getByRole('heading', { name: 'Nothing running yet' }),
    ).toBeVisible();
  });

  test('saves a prompt into the library', async ({ page }) => {
    await page.getByLabel('Prompt', { exact: true }).fill('A prompt worth keeping.');
    await page.getByRole('button', { name: 'Save prompt to library' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('E2E saved prompt');
    await dialog.getByRole('button', { name: 'Save prompt' }).click();

    await expect(page.getByText('Prompt saved')).toBeVisible();

    await page.goto('/prompts');
    await expect(page.getByRole('link', { name: 'E2E saved prompt' })).toBeVisible();
  });
});
