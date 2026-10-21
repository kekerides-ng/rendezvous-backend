/**
 * FIRST import, and the order is load-bearing.
 *
 * `app.module.ts` validates the environment at import time, and ES import
 * statements are hoisted — so calling `dotenv.config()` in this function body
 * would run AFTER AppModule had already been imported and already thrown. A
 * side-effect import executes in source order, which is early enough.
 *
 * In deploy there is no .env file and the platform injects real variables;
 * dotenv then finds nothing and does nothing, which is the desired no-op.
 */
import 'dotenv/config';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import cookieParser from 'cookie-parser';
import type Redis from 'ioredis';

import { AppModule } from './app.module';
import { CONFIG, CONFIG_WARNINGS } from './common/config';
import { REDIS } from './common/redis';
import { RedisIoAdapter } from './realtime';
import type { Env } from './common/config/env';
import { API_PREFIX_EXCLUSIONS, openApiConfig } from './common/http/openapi';
import { AppExceptionFilter } from './common/http/exception.filter';
import type { HealthService } from './common/http/health';
import { HEALTH_SERVICE } from './common/http/health.controller';
import { installGracefulShutdown } from './common/http/shutdown';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // pino takes over from Nest's own logger, so boot lines are structured and
    // redacted like everything else. Buffered until the logger is resolved.
    bufferLogs: true,
    // We install our own ordered handler in `installGracefulShutdown`.
    abortOnError: false,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get<Readonly<Env>>(CONFIG);
  const warnings = app.get<readonly string[]>(CONFIG_WARNINGS);
  for (const warning of warnings) logger.warn(warning);

  // One vocabulary of errors out of every route (common/http/errors.ts).
  app.useGlobalFilters(
    new AppExceptionFilter({
      onServerError: (error, { requestId }) => {
        logger.error({ err: error, correlationId: requestId }, 'unhandled server error');
      },
    }),
  );

  // The admin session is an httpOnly cookie, so something has to parse it
  // before AdminGuard can read it.
  app.use(cookieParser());

  // An allowlist, never a wildcard: the session is an httpOnly cookie, so a
  // permissive origin with credentials is a session-forwarding hole.
  app.enableCors({
    origin: [config.WEB_ORIGIN, config.ADMIN_ORIGIN],
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

  // The Redis adapter, so Socket.io works across more than one instance
  // (architecture.md §7). Installed BEFORE `listen`, because the adapter has
  // to be in place when the HTTP server starts accepting upgrades.
  //
  // CORS is set here too: a WebSocket upgrade is NOT covered by
  // `app.enableCors` above, and the default is to accept any origin.
  const socketAdapter = new RedisIoAdapter(app, app.get<Redis>(REDIS));
  socketAdapter.connect();
  app.useWebSocketAdapter(socketAdapter);

  // Every USER route is versioned under /v1, so the generated client in web
  // has a stable prefix to pin to.
  //
  // Admin routes are excluded and live at `/admin/*` (architecture.md §4,
  // CLAUDE.md layout). They are a separate surface with a separate origin, a
  // separate session cookie and a separate consumer, so versioning them
  // alongside the public API would tie an internal console's URLs to the
  // public contract's lifecycle for no benefit.
  app.setGlobalPrefix('v1', {
    exclude: API_PREFIX_EXCLUSIONS,
  });

  // This spec IS the contract with companion-web and companion-admin: they run
  // `bun run api:gen` against /docs-json (architecture.md §2).
  const document = SwaggerModule.createDocument(app, openApiConfig());
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: { persistAuthorization: true },
  });

  const health = app.get<HealthService>(HEALTH_SERVICE);
  installGracefulShutdown(app, health, {
    // Nothing is probing locally, so draining 10s just makes ctrl-C feel broken.
    drainMs: config.NODE_ENV === 'production' ? 10_000 : 0,
    onEvent: (message) => {
      logger.log(message);
    },
  });

  await app.listen(config.PORT);
  logger.log(
    `companion-backend listening on http://localhost:${String(config.PORT)} (docs: /docs, spec: /docs-json)`,
  );
}

void bootstrap();
