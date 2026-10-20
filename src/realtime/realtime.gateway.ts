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
 * TODO(human): decide how a socket authenticates.
 *
 * The session is an **httpOnly cookie** issued by this backend
 * (architecture.md §4). HTTP requests carry it automatically; a WebSocket does
 * not work the same way, and until this is settled every handler added in
 * steps 3.1 and 5.1 has no idea who is on the other end.
 *
 * Add a `handleConnection` body that establishes the user, joins
 * `user:<id>`, and disconnects anyone it cannot identify.
 *
 * Three ways to do it, and the trade is real:
 *
 *  1. **Read the cookie off the handshake.** `client.handshake.headers.cookie`
 *     is there, because the browser sends cookies on the upgrade request to the
 *     same origin. Nothing new to issue, and it expires exactly when the
 *     session does. But a WebSocket upgrade is **not subject to CORS**, so the
 *     origin check has to be done by hand — otherwise any site the user visits
 *     can open a socket as them. That is CSRF, over a socket.
 *
 *  2. **A short-lived ticket.** The client calls an authenticated HTTP endpoint,
 *     gets a one-time token valid for ~30 seconds, and passes it in
 *     `handshake.auth.token`. Immune to the CSRF problem, because a token has
 *     to be deliberately fetched and cannot be sent by a browser on its own.
 *     Costs a round trip before connecting, and a token store.
 *
 *  3. **Trust the cookie, verify the Origin header.** Option 1 plus an explicit
 *     `handshake.headers.origin` check against the allowlist already on this
 *     class as `allowedOrigins`.
 *
 * Worth knowing before choosing: `handleConnection` runs **after** the socket
 * is already connected, so rejecting means calling `client.disconnect(true)`
 * rather than refusing the handshake. And whatever you pick, the user id must
 * come from the server's own verification — never from something the client
 * sent, like a `userId` in the auth payload.
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
