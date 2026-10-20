import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * The Redis adapter, so Socket.io works across more than one instance
 * (architecture.md §7).
 *
 * Without it, two users connected to different instances cannot see each
 * other's messages — and it fails invisibly: with one instance in development
 * everything works, and the bug only appears the first time production scales
 * past one. Wiring it now costs nothing; finding it later costs a confusing
 * afternoon.
 *
 * It needs **two** connections. The subscriber is in subscribe mode, where
 * Redis refuses every other command, so it cannot be shared with the publisher
 * or with the app's ordinary client.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly redis: Redis,
  ) {
    super(app);
  }

  connect(): void {
    // Both options overridden, because `duplicate()` inherits the shared
    // client's settings and both of them kill the process when Redis is down.
    // Found by booting with Redis stopped, in two layers:
    //
    //   `enableOfflineQueue: false` → `createAdapter` SUBSCRIBEs immediately,
    //      which throws synchronously and takes the process with it.
    //   `maxRetriesPerRequest: 2`   → with the queue on, the queued commands
    //      are flushed as rejections after two attempts, unhandled, same result.
    //
    // The general rule, which BullMQ's connection follows for the same reason:
    // **a long-lived connection retries forever; a request-path connection
    // fails fast.** The shared client must fail fast so a readiness probe
    // reports unready instead of hanging. These two carry broadcasts, and
    // dropping a message because Redis blinked is worse than buffering it.
    const duplicateOptions = { enableOfflineQueue: true, maxRetriesPerRequest: null } as const;
    const pub = this.redis.duplicate(duplicateOptions);
    const sub = this.redis.duplicate(duplicateOptions);
    pub.on('error', () => undefined);
    sub.on('error', () => undefined);
    this.adapterConstructor = createAdapter(pub, sub);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
