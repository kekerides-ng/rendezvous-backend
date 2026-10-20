import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';

import { CONFIG } from '../common/config';
import type { Env } from '../common/config/env';

/**
 * The Socket.io gateway (architecture.md §7: chat, offers, typing, booking
 * updates, live location).
 *
 * A skeleton on purpose — the handlers land with their modules in steps 3.1
 * and 5.1. What is settled here is the shape every one of them inherits:
 *
 * **Rooms, never broadcasts.** Each connection joins `user:<id>`, and messages
 * are emitted to a room. A `server.emit()` goes to every connected socket in
 * the cluster, which on a product carrying private conversations is a data
 * leak one careless line away. There is no legitimate use of a global emit
 * here, so the habit is worth establishing before there are handlers.
 *
 * **CORS is the same allowlist as HTTP.** A WebSocket upgrade is not covered by
 * the HTTP CORS config, and the default is to accept any origin.
 *
 * **Authentication: a short-lived ticket, settled in `DECISIONS.md` I22.**
 *
 * Not the session cookie, and not by choice — HTTP goes through each app's own
 * Next route handlers (§2), so the session is first-party to the *app's*
 * origin and the browser will not send it to this one on a WebSocket upgrade.
 *
 * It is also the safer option on its own merits: a WebSocket upgrade is **not
 * subject to CORS**, so a cookie-authenticated socket would be openable by any
 * site the user happens to visit — CSRF, over a socket.
 *
 * The shape, to implement in **1.2** once user sessions exist:
 *   1. the client calls an authenticated HTTP endpoint for a ticket — a
 *      single-use token, ~30 seconds, held in Redis against the user id
 *   2. it passes the ticket in `handshake.auth.token`
 *   3. `handleConnection` redeems it, joins `user:<id>`, and calls
 *      `client.disconnect(true)` on anything it cannot identify
 *
 * Two things to keep: `handleConnection` runs **after** the socket connects,
 * so rejecting means disconnecting rather than refusing the handshake; and the
 * user id comes from redeeming the ticket server-side, **never** from anything
 * the client sent.
 */
@WebSocketGateway({ transports: ['websocket', 'polling'] })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(@Inject(CONFIG) private readonly config: Readonly<Env>) {}

  handleConnection(client: Socket): void {
    this.logger.debug({ socketId: client.id }, 'socket connected');
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug({ socketId: client.id }, 'socket disconnected');
  }

  /** The one way to reach a user, from anywhere in the app. */
  toUser(userId: string, event: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  /** Both sides of a conversation, without either knowing the other's socket. */
  toConversation(conversationId: string, event: string, payload: unknown): void {
    this.server.to(`conversation:${conversationId}`).emit(event, payload);
  }

  get allowedOrigins(): readonly string[] {
    return [this.config.WEB_ORIGIN, this.config.ADMIN_ORIGIN];
  }
}
