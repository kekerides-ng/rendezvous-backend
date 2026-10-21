import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RateLimitService } from '../../common/rate-limit';
import type { MediaRepo } from './media.repo';
import { MediaService } from './media.service';
import type { MediaStorage } from './storage';

const asset = {
  id: 'asset-1',
  userId: 'user-1',
  objectKey: 'user-1/photo.png',
  contentType: 'image/png',
  bytes: 128,
  status: 'uploading',
  createdAt: new Date(),
};

describe('media service', () => {
  const repo = {
    reserve: vi.fn(),
    owned: vi.fn(),
    lock: vi.fn(),
    setStatus: vi.fn(),
    forUser: vi.fn(),
    transaction: vi.fn(),
  };
  const storage = {
    ensureBucket: vi.fn(),
    sign: vi.fn(),
    head: vi.fn(),
    isImage: vi.fn(),
    remove: vi.fn(),
  };
  const rateLimit = { consume: vi.fn() };
  const service = new MediaService(
    repo as unknown as MediaRepo,
    storage as unknown as MediaStorage,
    rateLimit as unknown as RateLimitService,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    rateLimit.consume.mockResolvedValue({ allowed: true });
    repo.reserve.mockResolvedValue(asset);
    repo.owned.mockResolvedValue(asset);
    repo.forUser.mockResolvedValue([]);
    repo.lock.mockResolvedValue(asset);
    repo.setStatus.mockImplementation((_id: string, status: string) =>
      Promise.resolve({ ...asset, status }),
    );
    repo.transaction.mockImplementation((work: (r: typeof repo) => unknown) => work(repo));
    storage.sign.mockReturnValue('https://storage.example/signed');
    storage.head.mockResolvedValue({ bytes: 128, contentType: 'image/png' });
    storage.isImage.mockResolvedValue(true);
  });

  it('reserves only supported, bounded images and rate limits before storage', async () => {
    await expect(service.reserve('user-1', 'image/svg+xml', 128)).rejects.toThrow();
    await expect(service.reserve('user-1', 'image/png', 8 * 1024 * 1024 + 1)).rejects.toThrow();
    expect(rateLimit.consume).not.toHaveBeenCalled();
    rateLimit.consume.mockResolvedValue({ allowed: false });
    await expect(service.reserve('user-1', 'image/png', 128)).rejects.toBeInstanceOf(HttpException);
    expect(storage.ensureBucket).not.toHaveBeenCalled();
  });

  it('does not accept a missing or mismatched object', async () => {
    storage.head
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ bytes: 129, contentType: 'image/png' });
    await expect(service.complete('user-1', 'asset-1')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.complete('user-1', 'asset-1')).rejects.toBeInstanceOf(ConflictException);
    storage.isImage.mockResolvedValue(false);
    await expect(service.complete('user-1', 'asset-1')).rejects.toBeInstanceOf(ConflictException);
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it('makes a matching image available immediately, without a review step', async () => {
    repo.forUser.mockResolvedValue([asset]);
    expect((await service.mine('user-1')).items[0]?.url).toBeNull();
    const completed = await service.complete('user-1', 'asset-1');
    expect(completed.status).toBe('available');
    expect(completed.url).toBe('https://storage.example/signed');
    expect(repo.setStatus).toHaveBeenCalledWith('asset-1', 'available');
  });

  it('shows legacy reviewed photos as available to their owner', async () => {
    repo.forUser.mockResolvedValue([{ ...asset, status: 'rejected' }]);
    const photo = (await service.mine('user-1')).items[0];
    expect(photo?.status).toBe('available');
    expect(photo?.url).toBe('https://storage.example/signed');
  });

  it('rejects cross-account completion even after the first ownership read', async () => {
    repo.lock.mockResolvedValue({ ...asset, userId: 'user-2' });
    await expect(service.complete('user-1', 'asset-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.setStatus).not.toHaveBeenCalled();
  });
});
