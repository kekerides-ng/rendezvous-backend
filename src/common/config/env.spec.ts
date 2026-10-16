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
