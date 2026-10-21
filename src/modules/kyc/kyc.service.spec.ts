import { ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminService } from '../admin';
import type { AdminRequest } from '../admin/admin.guard';
import type { AuthService } from '../auth/auth.service';
import type { Env } from '../../common/config';
import type { KycRepo } from './kyc.repo';
import { KycService } from './kyc.service';

const verification = {
  id: 'verification-1',
  userId: 'user-1',
  status: 'review',
  resultCode: 'attention',
  reason: 'provider_review',
  adult: true,
  providerApproved: false,
  createdAt: new Date('2026-10-21T10:00:00Z'),
};

describe('KYC service', () => {
  const tx = { transaction: 'shared' };
  const repo = {
    forUser: vi.fn(),
    queue: vi.fn(),
    lock: vi.fn(),
    reject: vi.fn(),
    transaction: vi.fn(),
  };
  const admins = { audit: vi.fn() };
  const auth = { recordKycResult: vi.fn() };
  const service = new KycService(
    repo as unknown as KycRepo,
    admins as unknown as AdminService,
    auth as unknown as AuthService,
    { KYC_PROVIDER: 'youverify' } as Env,
  );
  const request = {
    admin: { id: 'admin-1' },
    ip: '127.0.0.1',
    get: () => 'test',
  } as unknown as AdminRequest;
  beforeEach(() => {
    vi.resetAllMocks();
    repo.forUser.mockResolvedValue(verification);
    repo.lock.mockResolvedValue(verification);
    repo.reject.mockResolvedValue({ ...verification, status: 'rejected' });
    repo.transaction.mockImplementation((work: (r: typeof repo, t: typeof tx) => unknown) =>
      work(repo, tx),
    );
  });
  it('returns not_started for users without a verification', async () => {
    repo.forUser.mockResolvedValue(undefined);
    expect(await service.status('user-1')).toEqual({
      status: 'not_started',
      provider: 'youverify',
    });
    expect(repo.forUser).toHaveBeenCalledWith('user-1');
  });
  it('does not touch the KYC table when the provider is off', async () => {
    const disabled = new KycService(
      repo as unknown as KycRepo,
      admins as unknown as AdminService,
      auth as unknown as AuthService,
      { KYC_PROVIDER: 'off' } as Env,
    );
    expect(await disabled.status('user-1')).toEqual({ status: 'not_started', provider: 'off' });
    await expect(disabled.requireVerifiedAdult('user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(await disabled.queue(1, 20)).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    await expect(disabled.reject('verification-1', 'reason', request)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.forUser).not.toHaveBeenCalled();
    expect(repo.queue).not.toHaveBeenCalled();
  });
  it('exposes no provider identifiers or evidence to users', async () => {
    expect(await service.status('user-1')).toEqual({ status: 'review', provider: 'youverify' });
  });
  it.each([
    undefined,
    { status: 'review', adult: true, providerApproved: true },
    { status: 'verified', adult: false, providerApproved: true },
    { status: 'verified', adult: true, providerApproved: false },
    { status: 'underage', adult: false, providerApproved: true },
  ])('denies offers unless identity and age are both verified (%j)', async (row) => {
    repo.forUser.mockResolvedValue(row);
    await expect(service.requireVerifiedAdult('user-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows a verified adult', async () => {
    repo.forUser.mockResolvedValue({ status: 'verified', adult: true, providerApproved: true });
    await expect(service.requireVerifiedAdult('user-1')).resolves.toBeUndefined();
  });
  it('audits a rejection in the same transaction, without raw evidence', async () => {
    await service.reject('verification-1', 'Evidence not sufficient', request);
    expect(repo.lock).toHaveBeenCalledWith('verification-1');
    expect(repo.reject).toHaveBeenCalledWith('verification-1', 'admin-1');
    expect(admins.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 'admin-1',
        action: 'kyc.reject',
        before: { status: 'review' },
        after: { status: 'rejected', reason: 'Evidence not sufficient' },
      }),
      tx,
    );
  });
  it('propagates audit failure to roll back the transaction', async () => {
    admins.audit.mockRejectedValue(new Error('audit failed'));
    await expect(
      service.reject('verification-1', 'Evidence not sufficient', request),
    ).rejects.toThrow('audit failed');
  });
  it.each(['verified', 'underage', 'rejected', 'pending'])(
    'does not reject a stale %s review',
    async (status) => {
      repo.lock.mockResolvedValue({ ...verification, status });
      await expect(
        service.reject('verification-1', 'Evidence not sufficient', request),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.reject).not.toHaveBeenCalled();
      expect(admins.audit).not.toHaveBeenCalled();
    },
  );
  it('does not trust missing admin context', async () => {
    await expect(
      service.reject('verification-1', 'Evidence not sufficient', {} as AdminRequest),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.transaction).not.toHaveBeenCalled();
  });
  it('keeps review responses free of provider and reviewer identifiers', async () => {
    repo.queue.mockResolvedValue({
      items: [{ ...verification, providerUserId: 'private', reviewedBy: 'private' }],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    const result = await service.queue(1, 20);
    expect(result.items[0]).not.toHaveProperty('providerUserId');
    expect(result.items[0]).not.toHaveProperty('reviewedBy');
  });
});
