import { ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminService } from '../admin';
import type { AdminRequest } from '../admin/admin.guard';
import type { AuthService } from '../auth/auth.service';
import type { RateLimitService } from '../../common/rate-limit';
import type { KycRepo } from './kyc.repo';
import { KycService } from './kyc.service';
import type { YouverifyClient } from './youverify';

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
    begin: vi.fn(),
    complete: vi.fn(),
  };
  const admins = { audit: vi.fn() };
  const auth = { recordKycResult: vi.fn() };
  const rateLimit = { consume: vi.fn() };
  const youverify = { verifyNin: vi.fn() };
  const service = new KycService(
    repo as unknown as KycRepo,
    admins as unknown as AdminService,
    auth as unknown as AuthService,
    rateLimit as unknown as RateLimitService,
    youverify as unknown as YouverifyClient,
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
    repo.begin.mockResolvedValue(true);
    rateLimit.consume.mockResolvedValue({ allowed: true });
    repo.transaction.mockImplementation((work: (r: typeof repo, t: typeof tx) => unknown) =>
      work(repo, tx),
    );
  });
  it('does not call the provider when a check is already in progress', async () => {
    repo.begin.mockResolvedValue(false);
    await expect(
      service.verifyNin('user-1', {
        nin: '11111111111',
        firstName: 'Ada',
        lastName: 'Okonkwo',
        dateOfBirth: '1990-04-04',
        selfie: 'data:image/jpeg;base64,YWJj',
        consent: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(youverify.verifyNin).not.toHaveBeenCalled();
  });
  it('persists a provider-checked adult and the auth age stamp together', async () => {
    const input = {
      nin: '11111111111',
      firstName: 'Ada',
      lastName: 'Okonkwo',
      dateOfBirth: '1990-04-04',
      selfie: 'data:image/jpeg;base64,YWJj',
      consent: true as const,
    };
    youverify.verifyNin.mockResolvedValue({
      success: true,
      data: {
        id: 'check123',
        status: 'found',
        country: 'NG',
        type: 'nin',
        idNumber: input.nin,
        isConsent: true,
        dataValidation: true,
        selfieValidation: true,
        allValidationPassed: true,
        dateOfBirth: input.dateOfBirth,
        validations: {
          data: {
            firstName: { validated: true },
            lastName: { validated: true },
            dateOfBirth: { validated: true },
          },
          selfie: { selfieVerification: { match: true } },
        },
      },
    });
    expect(await service.verifyNin('user-1', input)).toEqual({ status: 'verified' });
    expect(repo.complete).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        status: 'verified',
        providerApproved: true,
        providerJobId: 'check123',
      }),
    );
    expect(auth.recordKycResult).toHaveBeenCalledWith(
      'user-1',
      new Date('1990-04-04T00:00:00.000Z'),
      tx,
    );
  });
  it('leaves a retryable review state when the provider is unavailable', async () => {
    youverify.verifyNin.mockRejectedValue(new Error('secret upstream detail'));
    await expect(
      service.verifyNin('user-1', {
        nin: '11111111111',
        firstName: 'Ada',
        lastName: 'Okonkwo',
        dateOfBirth: '1990-04-04',
        selfie: 'data:image/jpeg;base64,YWJj',
        consent: true,
      }),
    ).rejects.toThrow('Identity check is unavailable. Please try again.');
    expect(repo.complete).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        status: 'review',
        providerApproved: false,
        reason: 'provider_unavailable',
      }),
    );
  });
  it('returns not_started for users without a verification', async () => {
    repo.forUser.mockResolvedValue(undefined);
    expect(await service.status('user-1')).toEqual({ status: 'not_started' });
    expect(repo.forUser).toHaveBeenCalledWith('user-1');
  });
  it('exposes no provider identifiers or evidence to users', async () => {
    expect(await service.status('user-1')).toEqual({ status: 'review' });
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
