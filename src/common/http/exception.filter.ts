import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { z } from 'zod';

import { getCorrelationId, newCorrelationId } from '../correlation/correlation';
import { type ApiError, ERROR_STATUS, type ErrorCode } from './errors';
import { ValidationFailedError } from './zod-validation.pipe';

/** Maps Nest's HTTP statuses onto our codes, so clients see one vocabulary. */
const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'MODERATION_REJECTED',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.BAD_GATEWAY]: 'ESCROW_TX_FAILED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'UPSTREAM_UNAVAILABLE',
};

export interface ExceptionFilterOptions {
  /** Called for every 5xx, so main.ts can log it with the pino instance. */
  readonly onServerError?: (error: unknown, context: { requestId: string }) => void;
}

interface HttpResponse {
  status: (code: number) => HttpResponse;
  json: (body: unknown) => void;
  setHeader?: (name: string, value: string) => void;
}

/**
 * Every error leaves the process as `{ code, message, requestId }`.
 *
 * The rule that matters: an UNEXPECTED error never leaks its message. A thrown
 * Postgres error can contain a connection string, a column name or a row's
 * contents, and a stack trace maps the codebase for anyone probing. So anything
 * that is not an explicit, intentional `HttpException` becomes a flat INTERNAL
 * with a generic message, and the real error goes to the logs keyed by
 * `requestId`. The client gets an id to quote; support can find the detail.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly options: ExceptionFilterOptions = {}) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<HttpResponse>();

    // The id the correlation middleware put on this request. A fresh one rather
    // than empty if somehow absent, because an error with no id is unsupportable.
    const requestId = getCorrelationId() ?? newCorrelationId();
    const { status, body } = this.render(exception, requestId);

    if (status >= 500) {
      this.options.onServerError?.(exception, { requestId });
    }

    response.setHeader?.('x-request-id', requestId);
    response.status(status).json(body);
  }

  private render(exception: unknown, requestId: string): { status: number; body: ApiError } {
    // --- our own validation pipe, and a raw ZodError from parsing upstream --
    const issues =
      exception instanceof ValidationFailedError
        ? exception.issues
        : exception instanceof z.ZodError
          ? exception.issues
          : undefined;

    if (issues) {
      return {
        status: ERROR_STATUS.VALIDATION_FAILED,
        body: {
          code: 'VALIDATION_FAILED',
          message: 'request validation failed',
          requestId,
          // Field-level detail is safe and genuinely useful here: it describes
          // what the CLIENT sent, not anything about our internals.
          details: issues.map((issue) => ({
            path: issue.path.join('.') || '(root)',
            message: issue.message,
          })),
        },
      };
    }

    // --- an intentional HttpException from a guard or handler ---------------
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload: unknown = exception.getResponse();

      // A handler may throw the full shape itself; respect it.
      if (typeof payload === 'object' && payload !== null && 'code' in payload) {
        const given = payload as { code: ErrorCode; message?: string };
        return {
          status,
          body: {
            code: given.code,
            message: given.message ?? exception.message,
            requestId,
          },
        };
      }

      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload
          ? String(payload.message)
          : exception.message;

      return {
        status,
        body: {
          code: STATUS_TO_CODE[status] ?? 'INTERNAL',
          // Safe: a guard's message is one we wrote deliberately.
          message,
          requestId,
        },
      };
    }

    // --- anything else -------------------------------------------------------
    // No message, no stack, no error class name. The detail is in the logs,
    // findable by requestId.
    return {
      status: ERROR_STATUS.INTERNAL,
      body: {
        code: 'INTERNAL',
        message: 'an unexpected error occurred',
        requestId,
      },
    };
  }
}
