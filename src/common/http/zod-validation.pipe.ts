import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/**
 * Thrown on a failed parse and turned into a `{ code, message, requestId }`
 * response by `AppExceptionFilter`. A distinct class so the filter can
 * recognise it without depending on zod internals.
 */
export class ValidationFailedError extends Error {
  constructor(readonly issues: readonly z.core.$ZodIssue[]) {
    super('validation failed');
    this.name = 'ValidationFailedError';
  }
}

/**
 * Validates and TRANSFORMS a request payload against a zod schema.
 *
 * zod rather than class-validator, even though DTO classes still carry Swagger
 * decorators (CLAUDE.md rule 2): zod gives one schema that both validates and
 * infers the type, so there is no second definition of the same shape to drift.
 *
 * It returns the PARSED value, not the input. That matters more than it looks:
 * `z.coerce.bigint()` on a money field hands the controller a bigint rather
 * than a string, which is exactly where micro-USDC precision would otherwise
 * be lost (CLAUDE.md rule 4).
 */
@Injectable()
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationFailedError(result.error.issues);
    }
    return result.data;
  }
}

/** `@Body(zodBody(createBookingSchema)) body: CreateBooking` */
export const zodBody = <TSchema extends z.ZodType>(schema: TSchema): ZodValidationPipe<TSchema> =>
  new ZodValidationPipe(schema);

/** `@Query(zodQuery(discoverQuerySchema)) query: DiscoverQuery` */
export const zodQuery = zodBody;

/** `@Param(zodParam(bookingParamsSchema)) params: BookingParams` */
export const zodParam = zodBody;
