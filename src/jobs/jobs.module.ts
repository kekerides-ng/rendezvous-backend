import { type DynamicModule, Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { QUEUES, type QueueName } from './queues';

/** DI token for the map of queue name → Queue. */
export const QUEUE_REGISTRY = Symbol('COMPANION_QUEUES');

/** DI token for BullMQ's dedicated connection. */
export const JOBS_CONNECTION = Symbol('COMPANION_JOBS_CONNECTION');

export type QueueRegistry = Readonly<Record<QueueName, Queue>>;

/**
 * BullMQ queues for slow, retryable or scheduled work (CLAUDE.md rule 8).
 *
 * **Its own Redis connection, not the shared one.** BullMQ's blocking commands
 * need `maxRetriesPerRequest: null`, and setting that on the shared client
 * would make every ordinary command retry forever instead of failing — the
 * readiness probe would hang rather than report unready. `common/redis` says
 * the same thing from the other side.
 *
 * Default job options are set here rather than per-queue so every job in the
 * system retries the same way:
 *
 * - **exponential backoff from 2s** — a failing third party is usually
 *   rate-limiting or restarting, and hammering it immediately makes both worse.
 * - **`removeOnComplete: 1000`** — keep a recent window for debugging without
 *   growing Redis forever.
 * - **`removeOnFail: false`** — a failed job is evidence. A notification that
 *   never arrived or a refund that never processed is something a human needs
 *   to be able to find.
 */
@Global()
@Module({})
export class JobsModule implements OnModuleDestroy {
  constructor(
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
    @Inject(JOBS_CONNECTION) private readonly connection: IORedis,
  ) {}

  static forRoot(options: { readonly url: string }): DynamicModule {
    const connection = new IORedis(options.url, {
      // Required by BullMQ: its blocking reads must not be retried away.
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    });
    connection.on('error', () => undefined);

    const registry = Object.fromEntries(
      Object.values(QUEUES).map((name) => [
        name,
        new Queue(name, {
          connection,
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 2_000 },
            removeOnComplete: 1_000,
            removeOnFail: false,
          },
        }),
      ]),
    ) as QueueRegistry;

    return {
      module: JobsModule,
      providers: [
        { provide: JOBS_CONNECTION, useValue: connection },
        { provide: QUEUE_REGISTRY, useValue: registry },
      ],
      exports: [QUEUE_REGISTRY],
    };
  }

  async onModuleDestroy(): Promise<void> {
    // Queues first: closing the connection underneath them loses in-flight
    // acknowledgements and the job comes back as stalled.
    await Promise.all(Object.values(this.queues).map((queue) => queue.close()));
    await this.connection.quit();
  }
}
