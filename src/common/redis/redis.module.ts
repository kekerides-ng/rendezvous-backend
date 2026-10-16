import { type DynamicModule, Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/** DI token for the shared Redis client. */
export const REDIS = Symbol('COMPANION_REDIS');

export interface RedisModuleOptions {
  readonly url: string;
}

/**
 * One Redis client, shared by the readiness check now and by rate limits, live
 * location and the Socket.io adapter from step 0.2.
 *
 * BullMQ is the exception and will open its own connections: it needs
 * `maxRetriesPerRequest: null` on a blocking connection, and setting that here
 * would make every ordinary command retry forever instead of failing.
 */
@Global()
@Module({})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly client: Redis) {}

  static forRoot(options: RedisModuleOptions): DynamicModule {
    const client = new Redis(options.url, {
      // Do not queue commands while disconnected: a readiness check must fail
      // fast rather than buffer and resolve minutes later against a stale view.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });

    // ioredis emits 'error' on every reconnect attempt. Without a listener,
    // Node treats it as an unhandled 'error' event and kills the process — so a
    // Redis blip would take the API down instead of just making it unready.
    client.on('error', () => undefined);

    return {
      module: RedisModule,
      providers: [{ provide: REDIS, useValue: client }],
      exports: [REDIS],
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
