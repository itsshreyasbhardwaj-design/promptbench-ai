import type { RunRecord, RunResultRecord } from '@/lib/db/models';
import type { BenchmarkSummary, ModelAggregate } from '@/lib/core/types';
import { formatLatency, formatTokens, formatUsd } from '@/lib/models/cost';
import { getModel, CATALOG_VERSION } from '@/lib/models/catalog';

/**
 * Report generation.
 *
 * Produces a self-contained comparison report in Markdown, HTML or JSON.
 * The HTML variant inlines its own styles and is print-ready, so "export PDF"
 * is the browser's own print-to-PDF against that page rather than a headless
 * Chromium dependency — which would add ~300MB to the deployment for a feature
 * every OS already provides, and would not work on a serverless runtime.
 */

export type ReportFormat = 'markdown' | 'html' | 'json';

export interface ReportInput {
  run: RunRecord;
  results: RunResultRecord[];
  workspaceName: string;
  /** True when responses came from the local simulator. */
  synthetic: boolean;
}

export interface Report {
  title: string;
  format: ReportFormat;
  content: string;
  filename: string;
}

export function generateReport(input: ReportInput, format: ReportFormat): Report {
  const title = `Model comparison — ${input.run.promptTemplate.slice(0, 60).trim() || 'Untitled'}`;
  const slug = input.run.id.replace(/[^a-z0-9]/gi, '-');

  const content =
    format === 'json'
      ? JSON.stringify(buildJsonReport(input), null, 2)
      : format === 'html'
        ? buildHtml(input, title)
        : buildMarkdown(input, title);

  return {
    title,
    format,
    content,
    filename: `promptbench-report-${slug}.${format === 'markdown' ? 'md' : format}`,
  };
}

// ── Narrative ───────────────────────────────────────────────────────────────

interface Recommendation {
  headline: string;
  detail: string;
}

/**
 * Derives the executive summary.
 *
 * The goal is to answer the three questions a reader actually has — what won,
 * what is the cheap option, and what should I watch out for — rather than
 * restating the table below it in prose.
 */
export function buildRecommendations(summary: BenchmarkSummary): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const { models } = summary;
  if (models.length === 0) return recommendations;

  const winner = models.find((m) => m.modelId === summary.winnerModelId);
  const bestValue = models.find((m) => m.modelId === summary.bestValueModelId);

  if (winner?.avgScore != null) {
    recommendations.push({
      headline: `${name(winner.modelId)} scored highest at ${winner.avgScore.toFixed(1)}/100`,
      detail:
        `Averaged ${formatLatency(winner.avgLatencyMs)} per response at ` +
        `${formatUsd(winner.avgCostUsd)} per call across ${winner.runs} run${
          winner.runs === 1 ? '' : 's'
        }.`,
    });
  }

  if (bestValue && winner && bestValue.modelId !== winner.modelId) {
    const saving =
      winner.avgCostUsd > 0
        ? Math.round((1 - bestValue.avgCostUsd / winner.avgCostUsd) * 100)
        : 0;
    recommendations.push({
      headline: `${name(bestValue.modelId)} is the better value`,
      detail:
        `It scores ${bestValue.avgScore?.toFixed(1)} — within ` +
        `${(winner.avgScore! - bestValue.avgScore!).toFixed(1)} points of the leader — ` +
        `while costing ${saving}% less per call. For high-volume workloads this is ` +
        `usually the correct choice.`,
    });
  }

  const fastest = [...models]
    .filter((m) => m.runs > m.failures)
    .sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0];
  if (fastest && fastest.modelId !== winner?.modelId) {
    recommendations.push({
      headline: `${name(fastest.modelId)} is fastest at ${formatLatency(fastest.avgLatencyMs)}`,
      detail: `p95 latency ${formatLatency(fastest.p95LatencyMs)}. Consider it for interactive, latency-sensitive paths.`,
    });
  }

  const unreliable = models.filter((m) => m.failures > 0);
  if (unreliable.length > 0) {
    recommendations.push({
      headline: 'Reliability issues observed',
      detail:
        unreliable
          .map((m) => `${name(m.modelId)} failed ${m.failures}/${m.runs} calls`)
          .join('; ') + '. Investigate before relying on these in production.',
    });
  }

  const spread = models.filter((m) => m.avgScore != null);
  if (spread.length > 1) {
    const best = Math.max(...spread.map((m) => m.avgScore!));
    const worst = Math.min(...spread.map((m) => m.avgScore!));
    if (best - worst < 5) {
      recommendations.push({
        headline: 'Scores are closely clustered',
        detail:
          `Only ${(best - worst).toFixed(1)} points separate best from worst. On this ` +
          `prompt the models are near-interchangeable on quality, so decide on cost ` +
          `and latency instead. A larger or more discriminating test set may be needed ` +
          `to separate them.`,
      });
    }
  }

  return recommendations;
}

// ── Markdown ────────────────────────────────────────────────────────────────

function buildMarkdown(input: ReportInput, title: string): string {
  const { run, results } = input;
  const summary = run.summary;
  const lines: string[] = [];

  lines.push(`# ${title}`, '');
  lines.push(
    `> Generated by [PromptBench AI](https://github.com/itsshreyasbhardwaj-design/promptbench-ai) ` +
      `on ${new Date().toISOString().slice(0, 10)} · Workspace: ${input.workspaceName}`,
    '',
  );

  if (input.synthetic) {
    lines.push(
      '> [!WARNING]',
      '> **Synthetic data.** These responses came from the deterministic local ' +
        'driver, not real models. Figures are illustrative and must not be cited ' +
        'as a benchmark. Set `OPENROUTER_API_KEY` to run against live models.',
      '',
    );
  }

  lines.push('## Executive summary', '');
  if (summary) {
    for (const rec of buildRecommendations(summary)) {
      lines.push(`- **${rec.headline}.** ${rec.detail}`);
    }
    lines.push('');
    lines.push(
      `Across **${summary.totalRuns}** completions on **${summary.models.length}** models: ` +
        `**${formatUsd(summary.totalCostUsd)}** total spend, ` +
        `**${formatTokens(summary.totalTokens)}** tokens, ` +
        `**${formatLatency(summary.avgLatencyMs)}** mean latency.`,
      '',
    );
  } else {
    lines.push('_No summary available for this run._', '');
  }

  lines.push('## Configuration', '');
  lines.push('| Setting | Value |', '| --- | --- |');
  lines.push(`| Run ID | \`${run.id}\` |`);
  lines.push(`| Status | ${run.status} |`);
  lines.push(`| Cases | ${run.caseCount} |`);
  lines.push(`| Models | ${run.modelIds.map((m) => `\`${m}\``).join(', ')} |`);
  lines.push(`| Started | ${run.startedAt ?? '—'} |`);
  lines.push(`| Catalog version | ${CATALOG_VERSION} |`);
  lines.push('');

  lines.push('### Prompt', '', '```text', run.promptTemplate, '```', '');
  if (run.systemPrompt) {
    lines.push('### System prompt', '', '```text', run.systemPrompt, '```', '');
  }

  if (summary && summary.models.length > 0) {
    lines.push('## Model comparison', '');
    lines.push(
      '| Rank | Model | Score | Win rate | Avg latency | p95 | Avg cost | Total cost | Failures |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    summary.models.forEach((model, index) => {
      lines.push(
        `| ${index + 1} | ${name(model.modelId)} | ${fmtScore(model.avgScore)} | ` +
          `${model.winRate === null ? '—' : `${(model.winRate * 100).toFixed(0)}%`} | ` +
          `${formatLatency(model.avgLatencyMs)} | ${formatLatency(model.p95LatencyMs)} | ` +
          `${formatUsd(model.avgCostUsd)} | ${formatUsd(model.totalCostUsd)} | ` +
          `${model.failures} |`,
      );
    });
    lines.push('');

    const criteria = collectCriteria(summary.models);
    if (criteria.length > 0) {
      lines.push('## Criterion breakdown', '');
      lines.push(
        `| Model | ${criteria.map(labelFor).join(' | ')} |`,
        `| --- | ${criteria.map(() => '---').join(' | ')} |`,
      );
      for (const model of summary.models) {
        const cells = criteria.map((c) => fmtScore(model.criterionAverages[c] ?? null));
        lines.push(`| ${name(model.modelId)} | ${cells.join(' | ')} |`);
      }
      lines.push('');
    }
  }

  lines.push('## Responses', '');
  const byCase = groupByCase(results);
  for (const [caseIndex, rows] of byCase) {
    lines.push(`### Case ${caseIndex + 1}`, '');
    const variables = rows[0]?.variables ?? {};
    if (Object.keys(variables).length > 0) {
      lines.push('**Variables**', '');
      for (const [key, value] of Object.entries(variables)) {
        lines.push(`- \`${key}\`: ${truncate(value, 200)}`);
      }
      lines.push('');
    }
    for (const row of rows) {
      const score = row.score === null ? '' : ` · score ${row.score.toFixed(1)}`;
      lines.push(
        `<details><summary><strong>${name(row.modelId)}</strong> — ` +
          `${formatLatency(row.latencyMs)} · ${formatUsd(row.costUsd)}${score}</summary>`,
        '',
        row.completion.error
          ? `**Error:** ${row.completion.error}`
          : row.completion.content,
        '',
        '</details>',
        '',
      );
    }
  }

  lines.push('---', '');
  lines.push(
    '_Cost figures are estimates based on published list pricing at catalog version ' +
      `${CATALOG_VERSION} and exclude any negotiated or volume discounts._`,
  );

  return lines.join('\n');
}

// ── HTML ────────────────────────────────────────────────────────────────────

function buildHtml(input: ReportInput, title: string): string {
  const { run } = input;
  const summary = run.summary;

  const recommendations = summary
    ? buildRecommendations(summary)
        .map(
          (r) =>
            `<li><strong>${escapeHtml(r.headline)}.</strong> ${escapeHtml(r.detail)}</li>`,
        )
        .join('')
    : '';

  const rows =
    summary?.models
      .map(
        (model, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><strong>${escapeHtml(name(model.modelId))}</strong><br><code>${escapeHtml(model.modelId)}</code></td>
          <td class="num">${fmtScore(model.avgScore)}</td>
          <td class="num">${model.winRate === null ? '—' : `${(model.winRate * 100).toFixed(0)}%`}</td>
          <td class="num">${formatLatency(model.avgLatencyMs)}</td>
          <td class="num">${formatUsd(model.avgCostUsd)}</td>
          <td class="num">${formatUsd(model.totalCostUsd)}</td>
          <td class="num">${model.failures}</td>
        </tr>`,
      )
      .join('') ?? '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; --fg:#0c0c10; --muted:#5a5f6e; --line:#e3e5ea; --accent:#4f46e5; --warn:#b45309; --warn-bg:#fffbeb; }
  * { box-sizing: border-box; }
  body { margin:0 auto; padding:48px 32px; max-width:960px; font:15px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--fg); background:#fff; }
  h1 { font-size:30px; letter-spacing:-.02em; margin:0 0 6px; }
  h2 { font-size:20px; letter-spacing:-.01em; margin:40px 0 12px; padding-bottom:8px; border-bottom:1px solid var(--line); }
  h3 { font-size:16px; margin:24px 0 8px; }
  .meta { color:var(--muted); font-size:13px; margin-bottom:28px; }
  .warn { background:var(--warn-bg); border:1px solid #fcd34d; color:var(--warn); padding:14px 16px; border-radius:10px; margin:20px 0; font-size:14px; }
  table { width:100%; border-collapse:collapse; margin:16px 0; font-size:14px; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
  td.num { text-align:right; font-variant-numeric:tabular-nums; }
  tbody tr:first-child td { background:#f8f8fc; }
  code { font:13px ui-monospace,SFMono-Regular,Menlo,monospace; background:#f4f4f7; padding:2px 5px; border-radius:4px; }
  pre { background:#f8f8fc; border:1px solid var(--line); border-radius:10px; padding:16px; overflow-x:auto; font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; word-break:break-word; }
  ul { padding-left:20px; }
  li { margin-bottom:8px; }
  footer { margin-top:48px; padding-top:16px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; }
  @media print { body { padding:0; max-width:none; } h2 { break-after:avoid; } table { break-inside:auto; } tr { break-inside:avoid; } }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Generated by PromptBench AI · ${new Date().toISOString().slice(0, 10)} · Workspace ${escapeHtml(input.workspaceName)} · Run <code>${escapeHtml(run.id)}</code></p>

  ${
    input.synthetic
      ? `<div class="warn"><strong>Synthetic data.</strong> These responses came from the deterministic local driver, not real models. Figures are illustrative and must not be cited as a benchmark.</div>`
      : ''
  }

  <h2>Executive summary</h2>
  ${recommendations ? `<ul>${recommendations}</ul>` : '<p>No summary available.</p>'}
  ${
    summary
      ? `<p>Across <strong>${summary.totalRuns}</strong> completions on <strong>${summary.models.length}</strong> models: <strong>${formatUsd(summary.totalCostUsd)}</strong> total spend, <strong>${formatTokens(summary.totalTokens)}</strong> tokens, <strong>${formatLatency(summary.avgLatencyMs)}</strong> mean latency.</p>`
      : ''
  }

  <h2>Model comparison</h2>
  <table>
    <thead><tr><th>#</th><th>Model</th><th>Score</th><th>Win rate</th><th>Avg latency</th><th>Avg cost</th><th>Total cost</th><th>Fails</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>Prompt</h2>
  <pre>${escapeHtml(run.promptTemplate)}</pre>
  ${run.systemPrompt ? `<h3>System prompt</h3><pre>${escapeHtml(run.systemPrompt)}</pre>` : ''}

  <footer>
    Cost figures are estimates based on published list pricing at catalog version ${CATALOG_VERSION}, and exclude negotiated or volume discounts.
    To export as PDF, use your browser's Print dialog and choose "Save as PDF".
  </footer>
</body>
</html>`;
}

function buildJsonReport(input: ReportInput) {
  return {
    generator: 'promptbench-ai',
    generatedAt: new Date().toISOString(),
    catalogVersion: CATALOG_VERSION,
    synthetic: input.synthetic,
    workspace: input.workspaceName,
    run: {
      id: input.run.id,
      status: input.run.status,
      promptTemplate: input.run.promptTemplate,
      systemPrompt: input.run.systemPrompt,
      modelIds: input.run.modelIds,
      caseCount: input.run.caseCount,
      startedAt: input.run.startedAt,
      finishedAt: input.run.finishedAt,
    },
    summary: input.run.summary,
    recommendations: input.run.summary ? buildRecommendations(input.run.summary) : [],
    results: input.results.map((r) => ({
      modelId: r.modelId,
      caseIndex: r.caseIndex,
      variables: r.variables,
      content: r.completion.content,
      error: r.completion.error ?? null,
      usage: r.completion.usage,
      cost: r.completion.cost,
      latencyMs: r.latencyMs,
      evaluation: r.evaluation,
    })),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function name(modelId: string): string {
  return getModel(modelId)?.name ?? modelId;
}

function fmtScore(score: number | null | undefined): string {
  return score === null || score === undefined ? '—' : score.toFixed(1);
}

function labelFor(criterionId: string): string {
  return criterionId.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function collectCriteria(models: ModelAggregate[]) {
  const set = new Set<keyof ModelAggregate['criterionAverages']>();
  for (const model of models) {
    for (const key of Object.keys(model.criterionAverages)) {
      set.add(key as keyof ModelAggregate['criterionAverages']);
    }
  }
  return [...set];
}

function groupByCase(results: RunResultRecord[]): Array<[number, RunResultRecord[]]> {
  const map = new Map<number, RunResultRecord[]>();
  for (const result of results) {
    const list = map.get(result.caseIndex) ?? [];
    list.push(result);
    map.set(result.caseIndex, list);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
