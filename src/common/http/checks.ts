import type { HealthCheck } from './health';

/**
 * These take the narrowest interface each client satisfies rather than the
 * client type itself, so a test can pass an object literal and the health code
 * never grows a dependency on ioredis just to call `ping()`.
 */

interface Queryable {
  query: (sql: string) => Promise<unknown>;
}

/**
 * `SELECT 1` against the pool.
 *
 * Deliberately trivial: the check must prove a connection can be acquired and a
 * round trip completes, nothing more. A readiness probe that runs a real query
 * will eventually be the slowest query in the system, and it runs every few
 * seconds on every instance.
 */
export const postgresCheck = (pool: Queryable, overrides?: Partial<HealthCheck>): HealthCheck => ({
  name: 'postgres',
  check: async () => {
    await pool.query('SELECT 1');
  },
  ...overrides,
});

interface Pingable {
  ping: () => Promise<string>;
}

/**
 * Critical by default, unlike the old RabbitMQ check: there is no outbox here.
 * Redis holds BullMQ queues, rate limits, the Socket.io adapter and live
 * location, so an instance that cannot reach it cannot serve a live session.
 */
export const redisCheck = (client: Pingable, overrides?: Partial<HealthCheck>): HealthCheck => ({
  name: 'redis',
  check: async () => {
    const reply = await client.ping();
    if (reply !== 'PONG') {
      throw new Error(`unexpected PING reply: ${reply}`);
    }
  },
  ...overrides,
});
