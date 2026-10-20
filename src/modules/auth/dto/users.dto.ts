import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

import type { User } from '../auth.schema';

export const usersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['all', 'active', 'suspended']).default('all'),
  sort: z.enum(['createdAt', 'lastLoginAt']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
export type UsersQuery = z.infer<typeof usersQuerySchema>;
export const reasonSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
export const userIdSchema = z.uuid();

export class ReasonDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 }) reason!: string;
}

export class UserItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true }) maskedPhone!: string | null;
  @ApiProperty() kycVerified!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastLoginAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) disabledAt!: string | null;
}

export class UsersPageDto {
  @ApiProperty({ type: [UserItemDto] }) items!: UserItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class RevealedPhoneDto {
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
}

export function toUserItem(user: User): UserItemDto {
  return {
    id: user.id,
    maskedPhone: user.phone ? `•••• ${user.phone.slice(-4)}` : null,
    kycVerified: user.kycVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    disabledAt: user.disabledAt?.toISOString() ?? null,
  };
}
