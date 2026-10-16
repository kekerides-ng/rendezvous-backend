import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** The header clients send and every response echoes back. */
export const CORRELATION_HEADER = 'x-request-id';

interface CorrelationStore {
  readonly correlationId: string;
}

/**
 * AsyncLocalStorage, not a request-scoped provider.
 *
 * A request id has to be reachable from code that has no idea a request exists
 * — a repo method, a pure domain function, a BullMQ job. Threading it through
 * every signature would poison every API, and Nest's REQUEST scope only reaches
 * providers, never plain functions. ALS attaches the id to the async context
 * instead, so `getCorrelationId()` works anywhere downstream of the middleware,
 * including inside a `db.transaction` callback.
 */
const storage = new AsyncLocalStorage<CorrelationStore>();

export const newCorrelationId = (): string => randomUUID();

/**
 * The current id, or undefined outside a request — a cron tick or a queue
 * consumer that has not opened its own context yet.
 */
export const getCorrelationId = (): string | undefined => storage.getStore()?.correlationId;

/**
 * Run `fn` with a request id attached to the async context. Used by the HTTP
 * middleware and, from step 0.2, by the BullMQ processor so a job inherits the
 * id of the request that enqueued it rather than starting a new trace.
 */
export const runWithCorrelationId = <T>(correlationId: string, fn: () => T): T =>
  storage.run({ correlationId }, fn);

/**
 * Take an inbound header value and make it safe to log and forward.
 *
 * The id arrives from outside, so it is untrusted input that ends up in log
 * lines. Anything unreasonable is replaced rather than sanitised: a caller
 * sending 8KB of junk in this header does not get to decide the shape of our
 * logs, and a newline in a log field is how log injection starts.
 */
export function normaliseCorrelationId(raw: unknown): string {
  if (typeof raw !== 'string') return newCorrelationId();

  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return newCorrelationId();
  // Word characters, dot, colon, hyphen. No whitespace, no control characters.
  if (!/^[\w.:-]+$/.test(trimmed)) return newCorrelationId();

  return trimmed;
}
