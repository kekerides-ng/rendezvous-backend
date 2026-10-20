import { type DynamicModule, Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

/** DI token for the Drizzle instance. */
export const DRIZZLE = Symbol('COMPANION_DRIZZLE');

/** DI token for the underlying pg Pool — the health check needs it, not queries. */
export const DRIZZLE_POOL = Symbol('COMPANION_DRIZZLE_POOL');

export interface DbModuleOptions {
  /** `postgres://user:pass@host:port/db` */
  readonly url: string;
  /** Pool size. */
  readonly max: number;
  /** Log every statement. Never in production: statements contain PII. */
  readonly logger?: boolean;
}

/**
 * One Postgres pool for the whole app, because this is one deploy against one
 * database (architecture.md §3).
 *
 * Note what is deliberately NOT here: a `search_path`. The old microservice
 * version pinned it per service, but every module declares its tables with
 * `pgSchema('<module>')`, so Drizzle always emits a schema-qualified name and an
 * unqualified table cannot resolve by accident. Module isolation is enforced by
 * the rule that a module imports only its own `*.schema.ts` (CLAUDE.md rule 1),
 * reviewed in code — not by a connection setting, which `SELECT * FROM
 * auth.users` sails straight past anyway.
 *
 * The schema generic stays open because the app's schema is assembled from the
 * module schema files as they land; a module injects `DRIZZLE` and narrows it.
 */
@Global()
@Module({})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(DRIZZLE_POOL) private readonly pool: Pool) {}

  static forRoot(options: DbModuleOptions): DynamicModule {
    const pool = new Pool({
      connectionString: options.url,
      max: options.max,
      // Fail fast rather than queueing behind an unreachable database.
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });

    const db = drizzle(pool, { logger: options.logger ?? false });

    return {
      module: DbModule,
      providers: [
        { provide: DRIZZLE_POOL, useValue: pool },
        { provide: DRIZZLE, useValue: db },
      ],
      exports: [DRIZZLE, DRIZZLE_POOL],
    };
  }

  /** Graceful shutdown: drain in-flight queries before the process goes away. */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

/** Convenience alias so a module can type its injected db. */
export type Database<TSchema extends Record<string, unknown> = Record<string, never>> =
  NodePgDatabase<TSchema>;

/** Shared transaction handle; modules still own all access to their tables. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | Transaction;
