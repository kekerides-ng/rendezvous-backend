/**
 * Liveness and readiness are different questions, and conflating them is one of
 * the more expensive mistakes available on any orchestrator:
 *
 *   liveness fails  -> the platform KILLS and RESTARTS the container
 *   readiness fails -> the instance is removed from the load balancer, no restart
 *
 * So a dependency check belongs in readiness ONLY. Put Postgres in the liveness
 * probe and a 30-second database blip restarts every instance at once: in-flight
 * work is lost, every instance reconnects simultaneously, and the thundering
 * herd makes the outage worse than if nothing had reacted at all. Readiness
 * failing is the correct response — stop taking traffic, keep the process,
 * recover when the dependency does.
 *
 * Liveness therefore answers only "is this process wedged?". It checks nothing
 * external and should be essentially impossible to fail except by deadlock.
 */

export interface HealthCheck {
  /** Appears in the readiness body, so keep it short: 'postgres', 'redis'. */
  readonly name: string;
  /** Throw or reject to fail. A returned value is ignored. */
  readonly check: () => Promise<void>;
  /**
   * A non-critical check is reported but does not make the instance unready.
   * Use it for a dependency the app degrades without rather than dies without.
   */
  readonly critical?: boolean;
  /** Per-check timeout in ms. Default 2000. */
  readonly timeoutMs?: number;
}

export interface CheckResult {
  readonly name: string;
  readonly status: 'up' | 'down';
  readonly critical: boolean;
  readonly durationMs: number;
  readonly error?: string;
}

export interface ReadinessReport {
  readonly status: 'ready' | 'not_ready';
  readonly shuttingDown: boolean;
  readonly checks: readonly CheckResult[];
}

const withTimeout = async (promise: Promise<void>, ms: number, name: string): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${name} check timed out after ${String(ms)}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Runs the registered checks and tracks shutdown state.
 *
 * A check is always given a timeout. Without one, a half-open TCP connection to
 * Postgres makes the readiness probe hang rather than fail, the platform times
 * the probe out anyway, and the instance's status becomes "unknown" instead of
 * "unready" — harder to reason about and slower to act on.
 */
export class HealthService {
  private readonly checks: HealthCheck[] = [];
  private shuttingDown = false;

  register(...checks: readonly HealthCheck[]): void {
    this.checks.push(...checks);
  }

  /**
   * Called from the SIGTERM handler, BEFORE the server stops accepting.
   *
   * This is the whole trick to a zero-downtime rolling deploy: readiness starts
   * failing immediately, the load balancer takes the instance out of rotation
   * over the next probe interval, and only then does the process close
   * connections. Exiting first instead means every in-flight request gets a
   * connection reset.
   */
  beginShutdown(): void {
    this.shuttingDown = true;
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /** Liveness: the event loop is turning. Deliberately checks nothing else. */
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async ready(): Promise<ReadinessReport> {
    const results = await Promise.all(
      this.checks.map(async (check): Promise<CheckResult> => {
        const startedAt = Date.now();
        const critical = check.critical ?? true;
        try {
          await withTimeout(check.check(), check.timeoutMs ?? 2_000, check.name);
          return {
            name: check.name,
            status: 'up',
            critical,
            durationMs: Date.now() - startedAt,
          };
        } catch (error) {
          return {
            name: check.name,
            status: 'down',
            critical,
            durationMs: Date.now() - startedAt,
            // Truncated: a connection error can carry a URL with credentials.
            error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
          };
        }
      }),
    );

    const failedCritical = results.some((r) => r.status === 'down' && r.critical);

    return {
      // Draining counts as not ready even when every dependency is healthy.
      status: this.shuttingDown || failedCritical ? 'not_ready' : 'ready',
      shuttingDown: this.shuttingDown,
      checks: results,
    };
  }
}
