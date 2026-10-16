import { z } from 'zod';

/**
 * Every error a client sees has this shape. `requestId` is the `x-request-id`
 * from the correlation middleware, so a user can quote it in a support message
 * and it maps straight to the log line.
 *
 * This vocabulary lives in the backend, not in a shared package: under the
 * four-repo rule there is no shared TypeScript between repos, and
 * `companion-contracts` is Solidity only. Web and admin learn these codes by
 * generating their clients from the OpenAPI spec (`bun run api:gen`), which is
 * why `apiErrorSchema` is registered with Swagger in `main.ts`.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'KYC_REQUIRED',
  'NOT_ADULT',
  'BLOCKED',
  'MODERATION_REJECTED',
  'FIRST_BOOKING_MUST_BE_PUBLIC_VENUE',
  'INVALID_STATE_TRANSITION',
  // Escrow-specific: the booking is not funded on chain yet, or funding failed.
  'ESCROW_NOT_FUNDED',
  'ESCROW_TX_FAILED',
  'UPSTREAM_UNAVAILABLE',
  'INTERNAL',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  /** Safe to show a user. Never an exception message or a stack trace. */
  message: z.string().min(1).max(500),
  requestId: z.string().min(1).max(128),
  /** Field-level detail for VALIDATION_FAILED only. */
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** HTTP status for each code, so every module maps them identically. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  KYC_REQUIRED: 403,
  NOT_ADULT: 403,
  BLOCKED: 403,
  MODERATION_REJECTED: 422,
  FIRST_BOOKING_MUST_BE_PUBLIC_VENUE: 422,
  INVALID_STATE_TRANSITION: 409,
  ESCROW_NOT_FUNDED: 409,
  ESCROW_TX_FAILED: 502,
  UPSTREAM_UNAVAILABLE: 503,
  INTERNAL: 500,
};
