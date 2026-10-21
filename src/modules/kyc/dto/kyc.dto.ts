import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { KYC_STATUSES } from '../domain/verification';

export class KycStatusDto {
  @ApiProperty({ enum: ['not_started', ...KYC_STATUSES] })
  status!: string;
  @ApiProperty({ enum: ['off', 'youverify'] })
  provider!: string;
}
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
