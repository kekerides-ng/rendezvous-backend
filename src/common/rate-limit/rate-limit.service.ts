import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import { REDIS } from '../redis';

/**
 * Redis rate limiting (architecture.md §8: login, OTP, offers, messages).
 *
 * Hand-written rather than `@nestjs/throttler`. Throttler is built around one
 * global policy applied per route, and what this product needs is per-ACTION
 * budgets with different windows and different keys — six OTP requests per
 * phone number per hour is not the same shape as thirty messages per
 * conversation per minute, and neither is "per IP". Bending throttler into
 * that costs more than forty lines and a Lua script, and the storage adapter
 * for Redis is a third-party package on the critical path of login.
 *
 * **A sliding window, not a fixed one.** A fixed window lets someone spend the
 * whole budget at 11:59:59 and the whole budget again at 12:00:00 — double the
 * limit across two seconds, which on OTP sends is the difference between a
 * rate limit and a bill. This keeps a sorted set of hit timestamps and drops
 * the ones that have aged out.
 *
 * The whole check is one Lua script so it is **atomic**: read-then-write from
 * the app is a race that two concurrent requests both win.
 */

/** Evicts aged-out hits, counts what is left, records this one if there is room. */
const SLIDING_WINDOW = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local used = redis.call('ZCARD', key)

if used >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfter = window - (now - tonumber(oldest[2]))
  return { 0, used, retryAfter }
end

redis.call('ZADD', key, now, member)
-- Expire slightly after the window so an idle key cleans itself up.
redis.call('PEXPIRE', key, window + 1000)
return { 1, used + 1, 0 }
`;

export interface RateLimitPolicy {
  /** How many hits are allowed in the window. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly used: number;
  readonly limit: number;
  /** Milliseconds until the oldest hit ages out. Zero when allowed. */
  readonly retryAfterMs: number;
}

/**
 * The budgets, named rather than inline, so they can be reviewed in one place
 * and so a controller cannot quietly invent a looser one.
 *
 * These are deliberately generous enough not to catch a real person on a bad
 * connection retrying, and tight enough that automated abuse is expensive.
 * OTP is the strictest because every send costs money and reaches a real
 * phone — it is the one an attacker turns into a bill, or into harassment of
 * whoever owns that number.
 */
export const RATE_LIMITS = {
  otpRequest: { limit: 5, windowMs: 60 * 60 * 1000 },
  otpVerify: { limit: 10, windowMs: 15 * 60 * 1000 },
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  offerCreate: { limit: 20, windowMs: 60 * 60 * 1000 },
  messageSend: { limit: 30, windowMs: 60 * 1000 },
  mediaUpload: { limit: 20, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitAction = keyof typeof RATE_LIMITS;

@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * `subject` is what the budget belongs to — a phone number, a user id, a
   * conversation id. **Not always the IP:** rate limiting OTP by IP punishes
   * everyone behind one mobile carrier NAT, which in Nigeria is a lot of
   * people, while costing an attacker with a handful of proxies nothing.
   */
  async consume(action: RateLimitAction, subject: string): Promise<RateLimitResult> {
    const policy = RATE_LIMITS[action];
    const now = Date.now();

    const [allowed, used, retryAfter] = (await this.redis.eval(
      SLIDING_WINDOW,
      1,
      `rl:${action}:${subject}`,
      String(now),
      String(policy.windowMs),
      String(policy.limit),
      // A unique member per hit: two requests in the same millisecond would
      // otherwise collapse into one entry in the sorted set and the second
      // would be free.
      `${String(now)}-${Math.random().toString(36).slice(2, 10)}`,
    )) as [number, number, number];

    return {
      allowed: allowed === 1,
      used,
      limit: policy.limit,
      retryAfterMs: Math.max(0, Math.ceil(retryAfter)),
    };
  }

  /** Clears a budget — used after a successful login, so one bad password
   * attempt does not count against someone for the next fifteen minutes. */
  async reset(action: RateLimitAction, subject: string): Promise<void> {
    await this.redis.del(`rl:${action}:${subject}`);
  }
}
