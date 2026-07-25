import { errorResponse } from '@/lib/api/handler';
import { requireSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/permissions';
import { enforceRateLimit, rateLimitIdentity } from '@/lib/api/rate-limit';
import { badRequest } from '@/lib/core/errors';
import { getRun } from '@/lib/services/benchmarks';
import { generateReport, type ReportFormat } from '@/lib/reports/generate';
import { getRepositories } from '@/lib/db';
import { usingLiveModels } from '@/lib/providers/registry';

export const runtime = 'nodejs';

const CONTENT_TYPES: Record<ReportFormat, string> = {
  markdown: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

/**
 * GET /api/v1/runs/:id/report?format=markdown|html|json
 *
 * Returns the raw document rather than a JSON envelope, so the URL can be
 * opened directly in a browser or piped straight to a file. `?download=1`
 * switches to an attachment disposition.
 */
export async function GET(
  request: Request,
  context: { params: Promise<Record<string, string>> },
): Promise<Response> {
  try {
    const session = await requireSession(request.headers);
    requirePermission(session.role, 'benchmark:read');
    await enforceRateLimit(rateLimitIdentity(request, session));

    const { id } = await context.params;
    if (!id) throw badRequest('A run id is required.');

    const url = new URL(request.url);
    const requested = url.searchParams.get('format') ?? 'markdown';
    if (!['markdown', 'html', 'json'].includes(requested)) {
      throw badRequest('`format` must be one of: markdown, html, json.');
    }
    const format = requested as ReportFormat;

    const { run, results } = await getRun(session, id);
    const workspace = await getRepositories().workspaces.findById(session.workspaceId);

    const report = generateReport(
      {
        run,
        results,
        workspaceName: workspace?.name ?? 'Workspace',
        synthetic: !usingLiveModels(),
      },
      format,
    );

    const disposition = url.searchParams.get('download')
      ? `attachment; filename="${report.filename}"`
      : 'inline';

    return new Response(report.content, {
      headers: {
        'Content-Type': CONTENT_TYPES[format],
        'Content-Disposition': disposition,
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
