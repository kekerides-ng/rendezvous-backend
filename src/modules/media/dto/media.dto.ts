import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { CONTENT_TYPES, MAX_BYTES } from '../domain/media';

export const assetIdSchema = z.uuid();
export const uploadSchema = z.object({
  contentType: z.enum(CONTENT_TYPES),
  bytes: z.number().int().min(1).max(MAX_BYTES),
});

export class UploadRequestDto {
  @ApiProperty({ enum: CONTENT_TYPES }) contentType!: string;
  @ApiProperty({ minimum: 1, maximum: MAX_BYTES }) bytes!: number;
}
export class UploadReservationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() uploadUrl!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}
export class AssetDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ enum: ['uploading', 'available'] }) status!: string;
  @ApiProperty({ enum: CONTENT_TYPES }) contentType!: string;
  @ApiProperty() bytes!: number;
  @ApiProperty({ type: String, nullable: true }) url!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class AssetListDto {
  @ApiProperty({ type: [AssetDto] }) items!: AssetDto[];
}
export class RemovedDto {
  @ApiProperty() removed!: boolean;
}
