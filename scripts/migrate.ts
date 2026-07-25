/**
 * Applies pending Drizzle migrations.
 *
 * Exits with a clear message rather than a stack trace when DATABASE_URL is
 * unset, because the most common reason to run this by accident is forgetting
 * that the app defaults to in-memory storage.
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error(
      'DATABASE_URL is not set.\n\n' +
        'PromptBench runs with in-memory storage by default, which needs no ' +
        'migrations. Set DATABASE_URL to a Postgres connection string to ' +
        'enable persistence, then run this again.',
    );
    process.exit(1);
  }

  // A single connection: migrations are serial by nature and a pool would just
  // hold idle sockets open against the migration lock.
  const client = postgres(url, { max: 1 });

  try {
    console.log('Applying migrations…');
    await migrate(drizzle(client), { migrationsFolder: './drizzle' });
    console.log('Migrations applied.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
