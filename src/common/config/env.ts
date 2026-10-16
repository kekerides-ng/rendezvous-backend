import { z } from 'zod';

/**
 * Infrastructure the app cannot run without. Validated once, at boot, so a bad
 * DATABASE_URL kills the process at startup with a readable message instead of
 * failing inside a request handler hours later. That is the whole point of
 * fail-fast config.
 */
export const infraEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Checked for scheme rather than parsed as a URL: a password with an
  // unescaped `@` or `#` makes `new URL()` succeed on the wrong host, which is
  // a confusing way to find out you are querying the wrong database.
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'must start with postgres:// or postgresql://',
    ),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  REDIS_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
      'must start with redis:// or rediss://',
    ),

  // MinIO locally, Cloudflare R2 in deploy (architecture.md §3, media module).
  S3_ENDPOINT: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_REGION: z.string().min(1).default('auto'),

  // CORS is an allowlist, never a wildcard: the session is an httpOnly cookie,
  // so a permissive origin is a credential-forwarding hole.
  WEB_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  ADMIN_ORIGIN: z.string().min(1).default('http://localhost:3001'),
});

/**
 * TODO(human): the chain block of the environment schema.
 *
 * These four variables are what the escrow module will read in build step 4.2.
 * Declaring them now, while the config loader is fresh in your head, is cheaper
 * than discovering in step 4.2 that staging boots with no operator key and
 * silently cannot issue refunds.
 *
 * Add to the object below:
 *   CHAIN_ID               - Base Sepolia is 84532, Base mainnet is 8453
 *   CHAIN_RPC_URL          - an https:// endpoint
 *   CHAIN_CONFIRMATIONS    - architecture.md §5 says default 5 on Base
 *   OPERATOR_PRIVATE_KEY   - a 0x-prefixed 32-byte hex string (66 chars total)
 *
 * The interesting decision is OPERATOR_PRIVATE_KEY. It must be REQUIRED in
 * production and ALLOWED TO BE EMPTY in development and test, because nobody
 * running `bun run test` should need a funded key. A plain `.optional()` cannot
 * express that, since the rule depends on NODE_ENV — which lives in the sibling
 * schema above, not in this one.
 *
 * Two ways to express a cross-field rule like that in zod:
 *   - `z.object({...}).superRefine((value, ctx) => ...)` on the MERGED schema,
 *     where both NODE_ENV and the key are visible
 *   - keep it `.optional()` here and let the escrow module refuse to start
 *
 * Pick one and say why in a comment. `appEnvSchema` below merges this block in,
 * so whatever you declare here lands in `Env` with full type inference.
 */
export const chainEnvSchema = z.object({
  // TODO(human): add the four chain variables described above.
});

export const appEnvSchema = infraEnvSchema.extend(chainEnvSchema.shape);

export type Env = z.infer<typeof appEnvSchema>;

export class EnvValidationError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[],
  ) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

/**
 * Levenshtein distance, capped — we only care about "is this within 2 edits".
 * Used to spot a typo'd var name, not to rank suggestions.
 */
function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) >= cap) return cap;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const row = [i, ...new Array<number>(b.length).fill(0)];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = (row[j - 1] ?? 0) + 1;
      const deletion = (prev[j] ?? 0) + 1;
      row[j] = Math.min(substitution, insertion, deletion);
    }
    prev = row;
    if (Math.min(...row) >= cap) return cap;
  }

  return prev[b.length] ?? cap;
}

/**
 * Env keys that look like a near-miss of something the schema wanted.
 *
 * We deliberately do NOT warn about every unclaimed variable: the OS supplies
 * PATH, HOME, SHLVL and dozens more, so that list is pure noise. A var within
 * two edits of a declared key is a different thing — it is almost certainly a
 * typo, and a typo is invisible otherwise, because the real key just reads as
 * "missing" while the value you set sits there unused.
 */
export function findProbableTypos(
  declaredKeys: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): { readonly provided: string; readonly probablyMeant: string }[] {
  const declared = new Set(declaredKeys);
  const found: { provided: string; probablyMeant: string }[] = [];

  for (const provided of Object.keys(env)) {
    if (declared.has(provided)) continue;
    // Only consider things shaped like app config, not arbitrary shell exports.
    if (!/^[A-Z][A-Z0-9_]{3,}$/.test(provided)) continue;

    for (const key of declaredKeys) {
      if (editDistance(provided, key) <= 2) {
        found.push({ provided, probablyMeant: key });
        break;
      }
    }
  }

  return found;
}

const describeTypo = ({
  provided,
  probablyMeant,
}: {
  provided: string;
  probablyMeant: string;
}): string => `${provided} is set, but nothing reads it — did you mean ${probablyMeant}?`;

/**
 * Validate the environment once, at boot, and never read `process.env` again.
 *
 * Throws `EnvValidationError` rather than calling `process.exit`, so a test can
 * assert on it; in the running app this happens during module construction, so
 * the process dies at startup.
 *
 * Unknown variables are stripped, not rejected — the environment always
 * contains PATH and friends. Near-misses of declared keys come back as warnings.
 */
export function loadEnv(env: Readonly<Record<string, string | undefined>> = process.env) {
  const result = appEnvSchema.safeParse(env);
  const declared = Object.keys(appEnvSchema.shape);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `${path}: ${issue.message}`;
    });
    const typos = findProbableTypos(declared, env).map(describeTypo);

    throw new EnvValidationError(
      [
        'Invalid environment for companion-backend:',
        ...issues.map((i) => `  ✗ ${i}`),
        ...(typos.length > 0 ? ['', 'Possible typos:', ...typos.map((t) => `  ⚠ ${t}`)] : []),
      ].join('\n'),
      [...issues, ...typos],
    );
  }

  return {
    env: result.data,
    warnings: findProbableTypos(declared, env).map(describeTypo),
  } as const;
}
