import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Request shapes are validated by zod (the global pipe), and documented by
 * Swagger classes. Two declarations for one shape is the cost of having both a
 * runtime guarantee and a generated client — the schemas below are the source
 * of truth, and the classes exist so `/docs-json` is complete (rule 2).
 */

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const totpSchema = z.object({
  challenge: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'must be six digits'),
});
export type TotpInput = z.infer<typeof totpSchema>;

export class LoginDto {
  @ApiProperty({ example: 'ada@rendezvous.ng' })
  email!: string;

  @ApiProperty({ example: 'correct horse battery staple' })
  password!: string;
}

export class TotpDto {
  @ApiProperty({ description: 'The challenge returned by /admin/auth/login' })
  challenge!: string;

  @ApiProperty({ example: '481902', description: 'Six digits from the authenticator' })
  code!: string;
}

export class LoginResponseDto {
  @ApiProperty({
    enum: ['totp_required', 'totp_enrolment'],
    description:
      'Never a session. A password alone is not enough to sign in; the TOTP step issues the cookie.',
  })
  kind!: 'totp_required' | 'totp_enrolment';

  @ApiProperty({ description: 'Pass to /admin/auth/totp. Expires in two minutes.' })
  challenge!: string;

  @ApiPropertyOptional({
    description: 'On first sign-in only: the otpauth:// URI to scan.',
  })
  uri?: string;
}

export class AdminProfileDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: ['admin', 'moderator'] }) role!: 'admin' | 'moderator';
  @ApiPropertyOptional({ type: String, format: 'date-time' }) lastLoginAt?: string | null;
}
