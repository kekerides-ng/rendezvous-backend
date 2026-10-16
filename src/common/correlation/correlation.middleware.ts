import type { IncomingMessage, ServerResponse } from 'node:http';

import { Injectable, type NestMiddleware } from '@nestjs/common';

import { CORRELATION_HEADER, normaliseCorrelationId, runWithCorrelationId } from './correlation';

/**
 * Reads `x-request-id` or mints one, echoes it back on the response, and opens
 * the async context everything downstream reads from.
 *
 * Echoing the header matters: the PWA can show the id when a request fails, and
 * support can find the exact log line from a screenshot.
 *
 * Registered as middleware rather than an interceptor on purpose — middleware
 * runs before guards, so an authentication failure is still traceable.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const correlationId = normaliseCorrelationId(req.headers[CORRELATION_HEADER]);
    res.setHeader(CORRELATION_HEADER, correlationId);
    runWithCorrelationId(correlationId, next);
  }
}
