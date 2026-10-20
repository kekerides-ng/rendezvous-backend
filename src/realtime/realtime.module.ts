import { Module } from '@nestjs/common';

import { RealtimeGateway } from './realtime.gateway';

/**
 * Exported so modules can push to a user without reaching for the raw server:
 * `realtime.toUser(id, 'booking.updated', payload)`.
 */
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
