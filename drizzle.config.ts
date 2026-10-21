import 'dotenv/config';

import { defineConfig } from 'drizzle-kit';

/**
 * Every module declares its tables in `src/modules/<module>/<module>.schema.ts`
 * inside `pgSchema('<module>')`, so this glob picks them all up and one
 * `db:generate` produces one migration across the whole app.
 *
 * `schemaFilter` must list every module schema drizzle-kit is allowed to touch.
 * Without it, drizzle-kit only introspects `public`, decides the module schemas
 * are undeclared, and happily writes a migration that drops them.
 */
export const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/companion';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/**/*.schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
  // Grows as modules land (architecture.md §3). Every module schema must be
  // listed, or drizzle-kit decides it is undeclared and writes a DROP.
  schemaFilter: ['public', 'admin', 'auth', 'kyc'],
  strict: true,
  verbose: true,
});
