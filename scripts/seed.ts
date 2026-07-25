/**
 * Seeds a workspace with example prompts and one completed benchmark run.
 *
 * The app seeds itself on first visit when NEXT_PUBLIC_DEMO_MODE is on; this
 * script exists for seeding a real Postgres database, where that per-request
 * path is not the right place to do bulk writes.
 */
import { seedDemoWorkspace } from '../src/lib/demo/seed';
import { ensureLocalWorkspace } from '../src/lib/auth/session';
import { runtimeCapabilities, serverEnv } from '../src/lib/env';

async function main() {
  const capabilities = runtimeCapabilities(serverEnv());

  if (!capabilities.persistentStorage) {
    console.warn(
      'DATABASE_URL is not set, so this will seed an in-memory store that ' +
        'disappears when the process exits. Set DATABASE_URL to seed a real ' +
        'database.',
    );
  }

  const { workspace } = await ensureLocalWorkspace();
  console.log(`Seeding workspace "${workspace.name}" (${workspace.id})…`);

  await seedDemoWorkspace({
    userId: 'user_local0000000000000',
    email: 'you@localhost',
    displayName: 'Local User',
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    role: 'owner',
    via: 'local',
  });

  console.log('Seed complete.');
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
