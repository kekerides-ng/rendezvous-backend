import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { runWithCorrelationId } from '../correlation/correlation';
import { AppExceptionFilter } from './exception.filter';
import { ValidationFailedError } from './zod-validation.pipe';

interface Captured {
  status: number;
  body: Record<string, unknown>;
}

const run = (exception: unknown, requestId = 'req-1'): Captured => {
  const captured: Captured = { status: 0, body: {} };
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body as Record<string, unknown>;
    },
    setHeader: () => undefined,
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as Parameters<AppExceptionFilter['catch']>[1];

  runWithCorrelationId(requestId, () => {
    new AppExceptionFilter().catch(exception, host);
  });
  return captured;
};

describe('AppExceptionFilter', () => {
  it('never leaks an unexpected error', () => {
    const leaky = new Error('password authentication failed for user "postgres"');
    const { status, body } = run(leaky);
    expect(status).toBe(500);
    expect(body).toEqual({
      code: 'INTERNAL',
      message: 'an unexpected error occurred',
      requestId: 'req-1',
    });
    // The whole point: no message, no stack, no class name.
    expect(JSON.stringify(body)).not.toContain('postgres');
  });

  it('reports a 5xx to the logger callback with the request id', () => {
    const onServerError = vi.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status: () => ({ json: () => undefined }),
          setHeader: () => undefined,
        }),
      }),
    } as unknown as Parameters<AppExceptionFilter['catch']>[1];

    runWithCorrelationId('req-9', () => {
      new AppExceptionFilter({ onServerError }).catch(new Error('boom'), host);
    });
    expect(onServerError).toHaveBeenCalledWith(expect.any(Error), { requestId: 'req-9' });
  });

  it('keeps field detail for a validation failure, which describes the CLIENT input', () => {
    const parsed = z.object({ amount: z.number() }).safeParse({ amount: 'ten' });
    const { status, body } = run(new ValidationFailedError(parsed.error!.issues));
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details).toEqual([{ path: 'amount', message: expect.any(String) }]);
  });

  it('handles a raw ZodError the same way', () => {
    const parsed = z.object({ amount: z.number() }).safeParse({});
    const { status, body } = run(parsed.error!);
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
  });

  it('keeps a deliberate HttpException message and maps its status to a code', () => {
    const { status, body } = run(new ForbiddenException('not your booking'));
    expect(status).toBe(403);
    expect(body).toMatchObject({ code: 'FORBIDDEN', message: 'not your booking' });
  });

  it('respects a handler that throws the full shape itself', () => {
    const { status, body } = run(
      new HttpException(
        { code: 'KYC_REQUIRED', message: 'verify to make an offer' },
        HttpStatus.FORBIDDEN,
      ),
    );
    expect(status).toBe(403);
    expect(body).toMatchObject({ code: 'KYC_REQUIRED', message: 'verify to make an offer' });
  });

  it('always attaches a request id, even with no correlation context', () => {
    const captured: Captured = { status: 0, body: {} };
    const response = {
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(body: unknown) {
        captured.body = body as Record<string, unknown>;
      },
      setHeader: () => undefined,
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as Parameters<AppExceptionFilter['catch']>[1];

    new AppExceptionFilter().catch(new Error('x'), host);
    expect(captured.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
