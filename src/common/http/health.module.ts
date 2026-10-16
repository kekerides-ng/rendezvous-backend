import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Pool } from 'pg';

import { DRIZZLE_POOL } from '../db/db.module';
import { REDIS } from '../redis/redis.module';
import { postgresCheck, redisCheck } from './checks';
import { HealthService } from './health';
import { HEALTH_SERVICE, HealthController } from './health.controller';

/**
 * Registers the dependency checks on module init rather than in the controller,
 * so the check list is wired in exactly one place and the controller stays a
 * dumb HTTP shell.
 */
@Module({
  controllers: [HealthController],
  providers: [{ provide: HEALTH_SERVICE, useFactory: () => new HealthService() }],
  exports: [HEALTH_SERVICE],
})
export class HealthModule implements OnModuleInit {
  constructor(
    @Inject(HEALTH_SERVICE) private readonly health: HealthService,
    @Inject(DRIZZLE_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    this.health.register(postgresCheck(this.pool), redisCheck(this.redis));
  }
}
