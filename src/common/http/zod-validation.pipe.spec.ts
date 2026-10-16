import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ValidationFailedError, ZodValidationPipe, zodBody } from './zod-validation.pipe';

const meta = { type: 'body' } as const;

describe('ZodValidationPipe', () => {
  it('returns the PARSED value, not the input', () => {
    // Why this matters: micro-USDC arrives as a JSON string and must reach the
    // controller as a bigint, or precision is already gone (CLAUDE.md rule 4).
    const pipe = new ZodValidationPipe(z.object({ amount: z.coerce.bigint() }));
    expect(pipe.transform({ amount: '250000000' }, meta)).toEqual({ amount: 250_000_000n });
  });

  it('strips unknown keys by default', () => {
    const pipe = zodBody(z.object({ note: z.string() }));
    expect(pipe.transform({ note: 'hi', isAdmin: true }, meta)).toEqual({ note: 'hi' });
  });

  it('rejects unknown keys when the schema is strict', () => {
    const pipe = zodBody(z.object({ note: z.string() }).strict());
    expect(() => pipe.transform({ note: 'hi', isAdmin: true }, meta)).toThrow(
      ValidationFailedError,
    );
  });

  it('throws our own error class, so the filter needs no zod knowledge', () => {
    const pipe = zodBody(z.object({ note: z.string() }));
    try {
      pipe.transform({}, meta);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationFailedError);
      expect((error as ValidationFailedError).issues).toHaveLength(1);
    }
  });
});
