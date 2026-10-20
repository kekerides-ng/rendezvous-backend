import { Global, Module } from '@nestjs/common';

import { RateLimitService } from './rate-limit.service';

/**
 * Global, because the modules that need limits — auth, messaging, booking,
 * media — are spread across the app and none of them should be importing each
 * other to get at it.
 */
@Global()
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
