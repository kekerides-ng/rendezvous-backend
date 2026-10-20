/**
 * Runs before any test module is imported, because `app.module.ts` validates
 * the environment at import time. Without this, importing AppModule in a test
 * throws EnvValidationError before a single test runs.
 *
 * These point at the docker-compose stack. Tests that need a live database say
 * so; the rest only need the values to parse.
 */
process.env.NODE_ENV = 'test';
process.env.PORT ??= '4000';
process.env.LOG_LEVEL ??= 'error';
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5433/companion';
process.env.REDIS_URL ??= 'redis://localhost:6380';
process.env.S3_ENDPOINT ??= 'http://localhost:9002';
process.env.S3_BUCKET ??= 'companion-media';
process.env.S3_ACCESS_KEY_ID ??= 'minioadmin';
process.env.S3_SECRET_ACCESS_KEY ??= 'minioadmin';

/**
 * Obviously-fake Privy credentials, so `AuthModule` constructs.
 *
 * `requirePrivy` throws without them, which is the module enforcing its own
 * requirement (DECISIONS I12) — and it caught this the moment AuthModule
 * landed, which is the behaviour working rather than a nuisance.
 *
 * Nothing here calls Privy: these tests never present a token. A test that
 * needs a verified identity injects a fake `IdentityProvider` instead, which
 * is what the seam in `domain/identity-provider.ts` is for.
 */
process.env.PRIVY_APP_ID ??= 'test-app-id';
process.env.PRIVY_APP_SECRET ??= 'test-app-secret';
