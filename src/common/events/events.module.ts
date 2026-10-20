import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

/**
 * In-process events, so a module can react to another without importing it
 * (CLAUDE.md rule 1, architecture.md §3): `booking.completed` → reviews opens
 * a window, with neither module knowing the other exists.
 *
 * Three settings worth understanding:
 *
 * - `wildcard` + `delimiter: '.'` make `booking.*` subscribable. Without it a
 *   listener has to name every event, and a new one is silently unobserved.
 * - `ignoreErrors: false` — a throwing listener should surface. The default
 *   swallows it, which means a failed review window looks like success.
 * - `maxListeners` raised from Node's default of 10. Eleven modules on a
 *   wildcard bus trip the leak warning immediately, and that warning is worth
 *   keeping meaningful.
 *
 * **These are not durable.** An in-process emitter loses everything on a crash
 * or a restart. Anything that must survive — a notification, a chain backfill,
 * an auto-release — goes to a BullMQ queue instead (see `jobs/`).
 */
@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      ignoreErrors: false,
      maxListeners: 50,
      verboseMemoryLeak: true,
    }),
  ],
})
export class EventsModule {}
