/** Database wrappers often hide pg/network errors in cause or AggregateError. */
export function databaseError(error: unknown): string {
  const seen = new Set<object>();
  function codeOf(value: unknown): string | undefined {
    if (typeof value !== 'object' || value === null || seen.has(value)) return undefined;
    seen.add(value);
    const record = value as Record<string, unknown>;
    const cause = codeOf(record.cause);
    if (cause) return cause;
    if (Array.isArray(record.errors)) {
      for (const child of record.errors) {
        const code = codeOf(child);
        if (code) return code;
      }
    }
    return typeof record.code === 'string' && /^[A-Z0-9_]+$/.test(record.code)
      ? record.code
      : undefined;
  }
  const code = codeOf(error);
  const hints: Record<string, string> = {
    ECONNREFUSED: 'Postgres is not accepting connections. Check docker compose ps and port 5433.',
    ENOTFOUND: 'The database hostname could not be resolved. Check DATABASE_URL locally.',
    EAI_AGAIN: 'Database hostname lookup failed. Check DNS and DATABASE_URL locally.',
    ETIMEDOUT: 'The database connection timed out. Check the database host and port.',
    EPERM: 'This process is not permitted to connect to Postgres.',
    '28P01':
      'Postgres rejected the password. DATABASE_URL must match the credentials used to initialize the existing Docker volume.',
    '28000': 'Postgres rejected authentication. Check the database role and connection settings.',
    '3D000':
      'The database does not exist. Check the database name in DATABASE_URL and POSTGRES_DB.',
    '42501': 'The database role lacks permission for this operation.',
    '42P01': 'A required table is missing. Apply migrations to this database.',
    '3F000': 'A required schema is missing. Apply migrations to this database.',
    '42P07':
      'A migration table already exists. Inspect migration history before retrying; do not reset the volume.',
    '42710':
      'A migration object already exists. Inspect migration history before retrying; do not reset the volume.',
    '42883':
      'A required database function is missing. Check that pgcrypto and the UUID migration were applied.',
  };
  // Never print wrapper messages: Drizzle includes SQL and parameter values there.
  return code
    ? `[${code}] ${hints[code] ?? 'Database operation failed. Inspect the Postgres server logs for this error code.'}`
    : 'Database operation failed without a driver error code. Check Postgres server logs; SQL and parameters are omitted.';
}
