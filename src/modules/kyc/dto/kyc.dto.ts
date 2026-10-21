import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { documentBirthDate, KYC_STATUSES } from '../domain/verification';

export class KycStatusDto {
  @ApiProperty({ enum: ['not_started', ...KYC_STATUSES] })
  status!: string;
}
export class VerifyNinDto {
  @ApiProperty({ example: '12345678901', description: 'Nigerian National Identification Number' })
  nin!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ format: 'date', example: '1995-04-23' }) dateOfBirth!: string;
  @ApiProperty({ description: 'JPEG or PNG selfie as a base64 data URL' }) selfie!: string;
  @ApiProperty({ enum: [true], description: 'Explicit consent to the identity check' })
  consent!: true;
}
export const verifyNinSchema = z.object({
  nin: z.string().regex(/^\d{11}$/),
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  dateOfBirth: z.string().refine((value) => documentBirthDate(value) !== undefined),
  selfie: z
    .string()
    .max(1_500_000)
    .regex(/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/),
  consent: z.literal(true),
});
export class KycReviewItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ enum: KYC_STATUSES }) status!: string;
  @ApiProperty({ type: String, nullable: true }) resultCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty() adult!: boolean;
  @ApiProperty() providerApproved!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class KycReviewPageDto {
  @ApiProperty({ type: [KycReviewItemDto] }) items!: KycReviewItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export const kycQueueSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
