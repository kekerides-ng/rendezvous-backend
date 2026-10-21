import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminService } from '../admin';
import type { AdminRequest } from '../admin/admin.guard';
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
  reason: null,
  createdAt: new Date(),
};

describe('media service', () => {
  const tx = { shared: true };
  const repo = {
    reserve: vi.fn(),
    owned: vi.fn(),
    lock: vi.fn(),
    setStatus: vi.fn(),
    queue: vi.fn(),
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
  const admins = { audit: vi.fn() };
  const rateLimit = { consume: vi.fn() };
  const service = new MediaService(
    repo as unknown as MediaRepo,
    storage as unknown as MediaStorage,
    admins as unknown as AdminService,
    rateLimit as unknown as RateLimitService,
  );
  const request = {
    admin: { id: 'admin-1' },
    ip: '127.0.0.1',
    get: () => 'test',
  } as unknown as AdminRequest;

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
    repo.transaction.mockImplementation((work: (r: typeof repo, t: typeof tx) => unknown) =>
      work(repo, tx),
    );
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

  it('does not submit a missing or mismatched object for moderation', async () => {
    storage.head
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ bytes: 129, contentType: 'image/png' });
    await expect(service.complete('user-1', 'asset-1')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.complete('user-1', 'asset-1')).rejects.toBeInstanceOf(ConflictException);
    storage.isImage.mockResolvedValue(false);
    await expect(service.complete('user-1', 'asset-1')).rejects.toBeInstanceOf(ConflictException);
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it('submits a matching image for review and hides uploading URLs', async () => {
    expect((await service.mine('user-1')).items).toEqual([]);
    const completed = await service.complete('user-1', 'asset-1');
    expect(completed.status).toBe('pending_review');
    expect(repo.setStatus).toHaveBeenCalledWith('asset-1', 'pending_review');
  });

  it('rejects cross-account completion even after the first ownership read', async () => {
    repo.lock.mockResolvedValue({ ...asset, userId: 'user-2' });
    await expect(service.complete('user-1', 'asset-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it('records moderation and audit in the same transaction', async () => {
    repo.lock.mockResolvedValue({ ...asset, status: 'pending_review' });
    await service.review('asset-1', 'reject', 'Photo is not a person', request);
    expect(admins.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'media.reject',
        subjectId: 'asset-1',
        before: { status: 'pending_review' },
        after: { status: 'rejected', reason: 'Photo is not a person' },
      }),
      tx,
    );
  });
});
