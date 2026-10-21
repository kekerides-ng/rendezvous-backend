import { randomUUID } from 'node:crypto';
import { ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { RateLimitService } from '../../common/rate-limit';
import { checkedPhoto } from './domain/media';
import { MediaRepo } from './media.repo';
import type { Asset } from './media.schema';
import { MediaStorage } from './storage';

@Injectable()
export class MediaService {
  constructor(
    private readonly repo: MediaRepo,
    private readonly storage: MediaStorage,
    private readonly rateLimit: RateLimitService,
  ) {}

  private present(row: Asset) {
    return {
      id: row.id,
      userId: row.userId,
      status: row.status === 'uploading' ? 'uploading' : 'available',
      contentType: row.contentType,
      bytes: row.bytes,
      url: row.status === 'uploading' ? null : this.storage.sign('GET', row.objectKey),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async reserve(userId: string, contentType: string, bytes: number) {
    checkedPhoto(contentType, bytes);
    const budget = await this.rateLimit.consume('mediaUpload', userId);
    if (!budget.allowed) throw new HttpException('Too many photo uploads. Try again later.', 429);
    await this.storage.ensureBucket();
    const extension =
      contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : 'webp';
    const objectKey = `${userId}/${randomUUID()}.${extension}`;
    const row = await this.repo.reserve(userId, objectKey, contentType, bytes);
    return {
      id: row.id,
      uploadUrl: this.storage.sign('PUT', objectKey, contentType),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }

  async complete(userId: string, id: string) {
    const row = await this.repo.owned(id, userId);
    if (row.status !== 'uploading')
      throw new ConflictException('This photo was already submitted.');
    if (Date.now() - row.createdAt.getTime() > 60 * 60_000)
      throw new ConflictException('Upload expired. Pick this photo again.');
    const object = await this.storage.head(row.objectKey);
    if (!object) throw new ConflictException('The photo has not been uploaded yet.');
    if (object.bytes !== row.bytes || object.contentType !== row.contentType)
      throw new ConflictException('The uploaded photo does not match its reservation.');
    if (!(await this.storage.isImage(row.objectKey, row.contentType)))
      throw new ConflictException('The uploaded file is not a valid image of the selected type.');
    const updated = await this.repo.transaction(async (repo) => {
      const locked = await repo.lock(id);
      if (locked.userId !== userId) throw new NotFoundException('Photo not found.');
      if (locked.status !== 'uploading')
        throw new ConflictException('This photo was already submitted.');
      return repo.setStatus(id, 'available');
    });
    return this.present(updated);
  }

  async mine(userId: string) {
    const rows = await this.repo.forUser(userId);
    return { items: rows.map((row) => this.present(row)) };
  }

  async remove(userId: string, id: string) {
    await this.repo.transaction(async (repo) => {
      const locked = await repo.lock(id);
      if (locked.userId !== userId) throw new NotFoundException('Photo not found.');
      await this.storage.remove(locked.objectKey);
      await repo.setStatus(id, 'deleted');
    });
    return { removed: true };
  }
}
