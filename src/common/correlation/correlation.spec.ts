import { describe, expect, it } from 'vitest';

import { getCorrelationId, normaliseCorrelationId, runWithCorrelationId } from './correlation';

describe('normaliseCorrelationId', () => {
  it('keeps a reasonable inbound id', () => {
    expect(normaliseCorrelationId('abc-123:def.4')).toBe('abc-123:def.4');
  });

  it('replaces a non-string', () => {
    expect(normaliseCorrelationId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(normaliseCorrelationId(['a', 'b'])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('replaces an over-long id', () => {
    expect(normaliseCorrelationId('x'.repeat(129))).not.toBe('x'.repeat(129));
  });

  it('replaces an id with a newline, which is how log injection starts', () => {
    const forged = 'abc\n{"level":"info","msg":"paid"}';
    expect(normaliseCorrelationId(forged)).not.toBe(forged);
  });
});

describe('runWithCorrelationId', () => {
  it('is undefined outside a request', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('survives an await boundary, which is why this is ALS and not a provider', async () => {
    await runWithCorrelationId('req-1', async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getCorrelationId()).toBe('req-1');
    });
  });

  it('keeps concurrent requests separate', async () => {
    const seen = await Promise.all([
      runWithCorrelationId('a', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getCorrelationId();
      }),
      runWithCorrelationId('b', async () => getCorrelationId()),
    ]);
    expect(seen).toEqual(['a', 'b']);
  });
});
