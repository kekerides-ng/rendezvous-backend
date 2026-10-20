import { Inject, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import { CONFIG, ConfigModule } from './common/config';
import { type Env, loadEnv } from './common/config/env';
import { CorrelationMiddleware } from './common/correlation';
import { DbModule } from './common/db';
import { EventsModule } from './common/events';
import { HealthModule } from './common/http/health.module';
import { AppLoggerModule } from './common/logging';
import { RateLimitModule } from './common/rate-limit';
import { RedisModule } from './common/redis';
import { JobsModule } from './jobs';
import { RealtimeModule } from './realtime';
import { AdminModule } from './modules/admin';

/**
 * Validated at import time, because the `imports` array below needs concrete
 * values to build the logger and the pool. That is the earliest possible
 * moment: a bad environment throws while this module is being loaded, so the
 * process dies before a single provider is constructed, let alone before
 * `app.listen()`. zod parsing is pure and cheap, so doing it here and again
 * inside `ConfigModule.forRoot()` costs nothing.
 *
 * The consequence to know about: importing `AppModule` in a test requires a
 * valid environment. That is what `test/setup-env.ts` is for.
 */
const { env } = loadEnv();

@Module({
  imports: [
    ConfigModule.forRoot(),
    AppLoggerModule.forRoot({
      level: env.LOG_LEVEL,
      pretty: env.NODE_ENV === 'development',
    }),
    DbModule.forRoot({
      url: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
      // Statements contain PII, so never outside development (CLAUDE.md rule 9).
      logger: env.NODE_ENV === 'development' && env.LOG_LEVEL === 'trace',
    }),
    RedisModule.forRoot({ url: env.REDIS_URL }),

    // Step 0.2. Each is global, so a feature module gets them by existing
    // rather than by importing — which also means no module can forget one.
    EventsModule,
    RateLimitModule,
    // Its own Redis connection: BullMQ's blocking reads need
    // `maxRetriesPerRequest: null`, which would break every ordinary command.
    JobsModule.forRoot({ url: env.REDIS_URL }),
    RealtimeModule,

    HealthModule,

    // Feature modules (architecture.md §3). Admin is first, because AdminGuard
    // and the audit log are infrastructure every later module writes to.
    AdminModule,
  ],
})
export class AppModule implements NestModule {
  constructor(@Inject(CONFIG) private readonly config: Readonly<Env>) {}

  /**
   * Middleware, not an interceptor: middleware runs before guards, so a request
   * that fails authentication still gets an id in its logs and its response.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*path');
  }

  get env(): Readonly<Env> {
    return this.config;
  }
}
