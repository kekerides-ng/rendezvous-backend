import { BadRequestException } from '@nestjs/common';

export const MAX_PHOTOS = 6;
export const MAX_BYTES = 8 * 1024 * 1024;
export const CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function checkedPhoto(contentType: string, bytes: number) {
  if (!CONTENT_TYPES.includes(contentType as (typeof CONTENT_TYPES)[number]))
    throw new BadRequestException('Use a JPEG, PNG or WebP photo.');
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_BYTES)
    throw new BadRequestException('Photos must be between 1 byte and 8 MB.');
}
