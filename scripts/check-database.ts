import 'dotenv/config';

import { Client } from 'pg';

import { databaseUrl } from '../drizzle.config';
import { databaseError } from './database-error';

async function main(): Promise<void> {
  const url = new URL(databaseUrl);
  console.log(
    `Checking Postgres at ${url.hostname}:${url.port || '5432'}${url.pathname} (credentials hidden)`,
  );
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const result = await client.query<{
      admin_users: string | null;
      users: string | null;
      migration_history: string | null;
      pgcrypto: boolean;
    }>(`
      select to_regclass('admin.admin_users')::text as admin_users,
             to_regclass('auth.users')::text as users,
             to_regclass('drizzle.__drizzle_migrations')::text as migration_history,
             exists(select 1 from pg_extension where extname = 'pgcrypto') as pgcrypto
    `);
    console.log('Connection successful.');
    console.log(result.rows[0]);
    if (!result.rows[0]?.admin_users || !result.rows[0].users)
      console.log('Application tables are missing. Run bun run db:migrate.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`Database check failed: ${databaseError(error)}`);
  process.exitCode = 1;
});
