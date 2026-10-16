import type { INestApplication } from '@nestjs/common';

import type { HealthService } from './health';

export interface ShutdownOptions {
  /**
   * How long to keep serving after readiness starts failing, so the load
   * balancer notices before connections close. Must exceed the readiness probe
   * interval times its failure threshold, or traffic is still arriving when the
   * server stops. Default 10s; 0 in development, where nothing is probing.
   */
  readonly drainMs?: number;
  readonly onEvent?: (message: string) => void;
}

/**
 * Graceful shutdown in the right ORDER, which is the part that is easy to get
 * wrong:
 *
 *   1. mark not-ready    -> the load balancer stops sending new requests
 *   2. wait `drainMs`    -> in-flight requests finish; the LB notices the 503
 *   3. close the app     -> Nest runs onModuleDestroy, draining pool and Redis
 *
 * Closing first instead means every in-flight request gets a connection reset,
 * and new requests keep arriving for as long as the LB has not re-probed.
 */
export function installGracefulShutdown(
  app: INestApplication,
  health: HealthService,
  options: ShutdownOptions = {},
): void {
  const drainMs = options.drainMs ?? 10_000;
  const log = options.onEvent ?? ((): void => undefined);
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    // A second SIGTERM during the drain must not start a parallel shutdown.
    if (shuttingDown) return;
    shuttingDown = true;

    log(`${signal} received: marking not ready, draining for ${String(drainMs)}ms`);
    health.beginShutdown();

    if (drainMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, drainMs));
    }

    log('drain complete: closing');
    await app.close();
    log('closed');
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void shutdown(signal));
  }
}
