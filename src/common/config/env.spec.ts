import { describe, expect, it } from 'vitest';

import { EnvValidationError, findProbableTypos, loadEnv } from './env';

const valid = {
  NODE_ENV: 'test',
  PORT: '4000',
  LOG_LEVEL: 'error',
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/companion',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'companion-media',
  S3_ACCESS_KEY_ID: 'minioadmin',
  S3_SECRET_ACCESS_KEY: 'minioadmin',
} as const;

describe('loadEnv', () => {
  it('coerces and defaults', () => {
    const { env } = loadEnv(valid);
    // The point of returning parsed data: PORT is a number, not '4000'.
    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.S3_REGION).toBe('auto');
    expect(env.WEB_ORIGIN).toBe('http://localhost:3000');
  });

  it('refuses a missing required var', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = valid;
    expect(() => loadEnv(withoutDb)).toThrow(EnvValidationError);
  });

  it('refuses a database url with the wrong scheme', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'mysql://localhost/companion' })).toThrow(
      /postgres/,
    );
  });

  it('strips unknown variables rather than rejecting them', () => {
    // The environment always has PATH and friends.
    const { env } = loadEnv({ ...valid, PATH: '/usr/bin', HOME: '/root' });
    expect(env).not.toHaveProperty('PATH');
  });

  it('names the failing variable in the message', () => {
    try {
      loadEnv({ ...valid, PORT: '99999' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).message).toContain('PORT');
    }
  });
});

describe('findProbableTypos', () => {
  it('spots a near-miss of a declared key', () => {
    const found = findProbableTypos(['DATABASE_URL'], { DATABSE_URL: 'x' });
    expect(found).toEqual([{ provided: 'DATABSE_URL', probablyMeant: 'DATABASE_URL' }]);
  });

  it('ignores ordinary shell variables', () => {
    // The whole reason we match on near-misses and not on "unclaimed".
    expect(findProbableTypos(['DATABASE_URL'], { PATH: '/usr/bin', HOME: '/root' })).toEqual([]);
  });

  it('ignores a key the schema actually declares', () => {
    expect(findProbableTypos(['DATABASE_URL'], { DATABASE_URL: 'x' })).toEqual([]);
  });
});

describe('the chain block', () => {
  it('defaults to Base Sepolia with 5 confirmations', () => {
    const { env } = loadEnv(valid);
    expect(env.CHAIN_ID).toBe(84_532);
    expect(env.CHAIN_CONFIRMATIONS).toBe(5);
    expect(env.CHAIN_RPC_URL).toBe('https://sepolia.base.org');
  });

  it('allows a local fork, so escrow integration tests can run', () => {
    // Not an enum of the two Base ids: Anvil is 31337.
    const { env } = loadEnv({ ...valid, CHAIN_ID: '31337' });
    expect(env.CHAIN_ID).toBe(31_337);
  });

  it('refuses an rpc url that is not https', () => {
    expect(() => loadEnv({ ...valid, CHAIN_RPC_URL: 'http://sepolia.base.org' })).toThrow(
      /https/,
    );
  });

  it('refuses a malformed operator key', () => {
    expect(() => loadEnv({ ...valid, OPERATOR_PRIVATE_KEY: '0xnope' })).toThrow(
      /OPERATOR_PRIVATE_KEY/,
    );
  });

  it('accepts a well-formed operator key', () => {
    const key = `0x${'a'.repeat(64)}`;
    const { env } = loadEnv({ ...valid, OPERATOR_PRIVATE_KEY: key });
    expect(env.OPERATOR_PRIVATE_KEY).toBe(key);
  });
});

describe('the operator key is required only in production', () => {
  const production = {
    ...valid,
    NODE_ENV: 'production',
    CHAIN_RPC_URL: 'https://mainnet.base.org',
  } as const;

  it('lets development and test boot without one', () => {
    // Nobody running `bun run test` should need a funded wallet.
    expect(() => loadEnv(valid)).not.toThrow();
    expect(() => loadEnv({ ...valid, NODE_ENV: 'development' })).not.toThrow();
  });

  it('treats an empty string as absent, not as a malformed key', () => {
    // `.env.example` ships OPERATOR_PRIVATE_KEY= with no value.
    expect(() => loadEnv({ ...valid, OPERATOR_PRIVATE_KEY: '' })).not.toThrow();
  });

  it('refuses to boot in production without one', () => {
    // A missing key in production is not a feature being unavailable — it is
    // refunds silently failing.
    expect(() => loadEnv(production)).toThrow(/OPERATOR_PRIVATE_KEY/);
    expect(() => loadEnv(production)).toThrow(/refunds/);
  });

  it('boots in production once it is set', () => {
    expect(() =>
      loadEnv({ ...production, OPERATOR_PRIVATE_KEY: `0x${'b'.repeat(64)}` }),
    ).not.toThrow();
  });
});
