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

  /**
   * Privy — the embedded-wallet provider that signs users in and creates their
   * Base wallet (architecture.md §4).
   *
   * The SECRET lives only here. `NEXT_PUBLIC_PRIVY_APP_ID` in the web app is
   * the public half; the secret is what proves to Privy that this server is
   * us, and anything prefixed `NEXT_PUBLIC_` is shipped to every browser.
   *
   * Optional in the schema for the same reason as the operator key
   * (DECISIONS I12): a deployment that does not run the auth module should
   * still boot. `requirePrivy()` below is what the auth module calls.
   */
  PRIVY_APP_ID: z
    .string()
    .min(1)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  PRIVY_APP_SECRET: z
    .string()
    .min(1)
    .optional()
    .or(z.literal('').transform(() => undefined)),

  // CORS is an allowlist, never a wildcard: the session is an httpOnly cookie,
  // so a permissive origin is a credential-forwarding hole.
  WEB_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  ADMIN_ORIGIN: z.string().min(1).default('http://localhost:3001'),
});

/**
 * The chain block (architecture.md §5). Read by the escrow module in step 4.2.
 *
 * Declared now rather than in 4.2 so a misconfigured deploy dies at boot with
 * a readable message, instead of discovering months later that staging has no
 * operator key and has silently been unable to issue refunds.
 */
export const chainEnvSchema = z.object({
  // Base Sepolia is 84532, Base mainnet is 8453. Not an enum: a local Anvil
  // fork uses 31337, and refusing to boot against a fork would make the
  // escrow integration tests impossible to run.
  CHAIN_ID: z.coerce.number().int().positive().default(84_532),

  CHAIN_RPC_URL: z
    .string()
    .min(1)
    .refine((value) => value.startsWith('https://'), 'must start with https://')
    .default('https://sepolia.base.org'),

  // architecture.md §5: act on a chain event only after N confirmations.
  CHAIN_CONFIRMATIONS: z.coerce.number().int().min(1).max(100).default(5),

  // 0x + 64 hex characters. Checked for SHAPE only — a well-formed key that is
  // not funded is a runtime problem, and we never log or echo this value
  // (see common/logging/redact.ts).
  //
  // Optional HERE on purpose. Whether it is required depends on NODE_ENV, and
  // config has no business knowing that a chain variable is conditional on an
  // infra one. The module that needs the key enforces it — see
  // `requireOperatorKey` below.
  OPERATOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'must be 0x followed by 64 hex characters')
    .optional()
    .or(z.literal('').transform(() => undefined)),
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

/**
 * The escrow module calls this at construction and refuses to start without a
 * key (architecture.md §5: OPERATOR signs refunds and keeper releases).
 *
 * Enforced by the module rather than by `loadEnv`, which is the second of the
 * two options and the right one for this architecture. Three reasons:
 *
 *   - **Modules are meant to be splittable into services** (architecture.md §3).
 *     A boot-time check would make a future profile or messaging service refuse
 *     to start in production over a key it will never use.
 *   - **Config validates shape; modules enforce their own requirements.** A
 *     cross-field rule in `loadEnv` means the config layer has to know that a
 *     chain variable is conditional on an infra one.
 *   - **It still fails fast.** Nest builds the whole module graph at startup,
 *     so in any deployment that includes escrow the process dies at boot
 *     exactly as it would have — just scoped to the deployments that care.
 *
 * It throws `EnvValidationError` so the message reads identically to a config
 * failure, because from the operator's point of view that is what it is.
 */
export function requireOperatorKey(env: Pick<Env, 'OPERATOR_PRIVATE_KEY' | 'NODE_ENV'>): string {
  if (env.OPERATOR_PRIVATE_KEY) return env.OPERATOR_PRIVATE_KEY;

  throw new EnvValidationError(
    [
      'The escrow module cannot start without an operator key:',
      '  ✗ OPERATOR_PRIVATE_KEY: not set',
      '',
      'It signs refunds and keeper releases. Without it a cancelled booking',
      "cannot be refunded, which fails silently from the user's side.",
    ].join('\n'),
    ['OPERATOR_PRIVATE_KEY: not set'],
  );
}

/**
 * The auth module calls this at construction and refuses to start without
 * Privy credentials — same shape as `requireOperatorKey`, same reasoning
 * (DECISIONS I12): config validates shape, the module that needs a thing
 * enforces that it is there.
 */
export function requirePrivy(env: Pick<Env, 'PRIVY_APP_ID' | 'PRIVY_APP_SECRET'>): {
  appId: string;
  appSecret: string;
} {
  if (env.PRIVY_APP_ID && env.PRIVY_APP_SECRET) {
    return { appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET };
  }

  throw new EnvValidationError(
    [
      'The auth module cannot start without Privy credentials:',
      `  ✗ PRIVY_APP_ID: ${env.PRIVY_APP_ID ? 'set' : 'not set'}`,
      `  ✗ PRIVY_APP_SECRET: ${env.PRIVY_APP_SECRET ? 'set' : 'not set'}`,
      '',
      'They verify the token a user signs in with. Without them nobody can log',
      'in at all. Get them from dashboard.privy.io — see docs/SERVICES.md.',
    ].join('\n'),
    ['PRIVY_APP_ID or PRIVY_APP_SECRET not set'],
  );
}
