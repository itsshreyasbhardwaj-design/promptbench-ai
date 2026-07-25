import { AppShell } from '@/components/app-shell';
import { getSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/db';
import { runtimeCapabilities, serverEnv } from '@/lib/env';
import { seedDemoWorkspace } from '@/lib/demo/seed';
import { clientEnv } from '@/lib/env';

/**
 * Authenticated application shell.
 *
 * Rendered dynamically because the session, workspace and runtime mode are all
 * per-request. The marketing route group outside this layout stays static.
 */
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const capabilities = runtimeCapabilities(serverEnv());

  // In demo mode, populate an empty workspace with example prompts and a
  // completed run so every screen has something real to render on first visit.
  // Idempotent, and a no-op once the workspace has any content of its own.
  if (clientEnv.NEXT_PUBLIC_DEMO_MODE && session) {
    await seedDemoWorkspace(session);
  }

  const workspace = session
    ? await getRepositories().workspaces.findById(session.workspaceId)
    : null;

  return (
    <AppShell workspaceName={workspace?.name ?? 'Workspace'} mode={capabilities.mode}>
      {children}
    </AppShell>
  );
}
