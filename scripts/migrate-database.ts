import 'dotenv/config';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import config, { databaseUrl } from '../drizzle.config';
import { databaseError } from './database-error';

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    console.log('Applying database migrations…');
    await migrate(drizzle(pool), { migrationsFolder: config.out ?? './drizzle' });
    console.log('Database migrations complete.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`Migration failed: ${databaseError(error)}`);
  process.exitCode = 1;
});
