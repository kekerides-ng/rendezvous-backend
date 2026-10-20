import { describe, expect, it } from 'vitest';

import { RATE_LIMITS, RateLimitService } from './rate-limit.service';

/**
 * A fake Redis that runs the same sliding-window logic the Lua script does.
 *
 * The script itself is only meaningfully testable against a real Redis, which
 * belongs in an integration test once docker-compose is part of CI. What these
 * cover is the service's contract — the arguments it passes, the shape it
 * returns, and the policies themselves, which are a product decision and the
 * thing most likely to be edited carelessly.
 */
class FakeRedis {
  private readonly hits = new Map<string, number[]>();

  eval(
    _script: string,
    _numKeys: number,
    key: string,
    nowArg: string,
    windowArg: string,
    limitArg: string,
  ): Promise<[number, number, number]> {
    const now = Number(nowArg);
    const window = Number(windowArg);
    const limit = Number(limitArg);

    const existing = (this.hits.get(key) ?? []).filter((at) => at > now - window);

    if (existing.length >= limit) {
      this.hits.set(key, existing);
      const oldest = existing[0] ?? now;
      return Promise.resolve([0, existing.length, window - (now - oldest)]);
    }

    existing.push(now);
    this.hits.set(key, existing);
    return Promise.resolve([1, existing.length, 0]);
  }

  del(key: string): Promise<number> {
    this.hits.delete(key);
    return Promise.resolve(1);
  }
}

const make = () => {
  const redis = new FakeRedis();
  return {
    redis,
    service: new RateLimitService(redis as unknown as never),
  };
};

describe('RateLimitService', () => {
  it('allows up to the limit, then refuses', async () => {
    const { service } = make();
    const { limit } = RATE_LIMITS.otpRequest;

    for (let i = 0; i < limit; i++) {
      const result = await service.consume('otpRequest', '+2348034124521');
      expect(result.allowed).toBe(true);
      expect(result.used).toBe(i + 1);
    }

    const blocked = await service.consume('otpRequest', '+2348034124521');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('keeps budgets separate per subject', async () => {
    const { service } = make();
    for (let i = 0; i < RATE_LIMITS.otpRequest.limit; i++) {
      await service.consume('otpRequest', 'a');
    }

    // One exhausted number must not lock out everybody else.
    const other = await service.consume('otpRequest', 'b');
    expect(other.allowed).toBe(true);
  });

  it('keeps budgets separate per action', async () => {
    const { service } = make();
    for (let i = 0; i < RATE_LIMITS.otpRequest.limit; i++) {
      await service.consume('otpRequest', 'a');
    }

    const verify = await service.consume('otpVerify', 'a');
    expect(verify.allowed).toBe(true);
  });

  it('reset clears the budget', async () => {
    const { service } = make();
    for (let i = 0; i < RATE_LIMITS.login.limit; i++) {
      await service.consume('login', 'a');
    }
    expect((await service.consume('login', 'a')).allowed).toBe(false);

    // After a successful login, earlier failures must not keep counting.
    await service.reset('login', 'a');
    expect((await service.consume('login', 'a')).allowed).toBe(true);
  });
});

describe('the policies themselves', () => {
  it('makes OTP the strictest, because each send costs money', () => {
    // Every OTP reaches a real phone. It is the budget an attacker turns into
    // a bill, or into harassment of whoever owns that number.
    expect(RATE_LIMITS.otpRequest.limit).toBeLessThanOrEqual(RATE_LIMITS.login.limit);
    expect(RATE_LIMITS.otpRequest.windowMs).toBeGreaterThanOrEqual(RATE_LIMITS.login.windowMs);
  });

  it('gives every action a positive limit and window', () => {
    for (const [name, policy] of Object.entries(RATE_LIMITS)) {
      expect(policy.limit, name).toBeGreaterThan(0);
      expect(policy.windowMs, name).toBeGreaterThan(0);
    }
  });
});
