import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, ApiResponse } from '@nestjs/swagger';

import { ERROR_CODES } from './errors';

/**
 * The error envelope, as Swagger sees it.
 *
 * `errors.ts` declares the shape in zod for the runtime; this declares it for
 * the spec. Both are needed, and the gap between them was a real bug: without
 * an `@ApiResponse` naming this type, `openapi-typescript` generates clients
 * whose `error` is `never` — so every `if (error)` in web and admin is dead
 * code the type system believes can never run, and a failed request falls
 * through to "success with no data".
 *
 * Rule 2 says the spec is complete. A spec that documents only the happy path
 * is not.
 */
export class ApiErrorDto {
  @ApiProperty({ enum: ERROR_CODES, example: 'UNAUTHENTICATED' })
  code!: (typeof ERROR_CODES)[number];

  @ApiProperty({
    example: 'Email or password is wrong.',
    description: 'Safe to show a user. Never an exception message or a stack trace.',
  })
  message!: string;

  @ApiProperty({
    description: 'The x-request-id. Quote it in a support message to find the log line.',
  })
  requestId!: string;

  @ApiPropertyOptional({
    description: 'Field-level detail, for VALIDATION_FAILED.',
    type: 'array',
    items: {
      type: 'object',
      properties: { path: { type: 'string' }, message: { type: 'string' } },
    },
  })
  details?: { path: string; message: string }[];
}

/**
 * Attach the error envelope to an endpoint.
 *
 * A decorator rather than repeating `@ApiResponse` per status per route,
 * because the one that gets forgotten is the one a client then cannot handle.
 */
export const ApiErrors = (...statuses: number[]) =>
  applyDecorators(
    ApiExtraModels(ApiErrorDto),
    ...statuses.map((status) =>
      ApiResponse({ status, type: ApiErrorDto, description: DESCRIPTIONS[status] ?? 'Error' }),
    ),
  );

const DESCRIPTIONS: Record<number, string> = {
  400: 'The request body failed validation.',
  401: 'Not signed in, or the credentials were wrong.',
  403: 'Signed in, but not allowed to do this.',
  404: 'No such thing.',
  409: 'Conflicts with the current state.',
  429: 'Rate limited. Try again later.',
  502: 'An upstream service is unavailable.',
};
