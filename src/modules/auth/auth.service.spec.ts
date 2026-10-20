import {
  ConflictException,
  ForbiddenException,
  type HttpException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database, Transaction } from '../../common/db';
import type { RateLimitService } from '../../common/rate-limit';
import type { AdminService } from '../admin';
import type { AdminRequest } from '../admin/admin.guard';
import { AuthRepo } from './auth.repo';
import type { User } from './auth.schema';
import { AuthService } from './auth.service';
import { reasonSchema, toUserItem, usersQuerySchema } from './dto/users.dto';

const now = new Date('2026-10-20T10:00:00Z');
function user(disabledAt: Date | null = null): User {
  return {
    id: '019a0123-4567-7123-8123-123456789abc',
    providerUserId: 'test-provider',
    phone: '+2348012345678',
    email: 'private@example.test',
    dateOfBirth: now,
    kycVerifiedAt: null,
    disabledAt,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function setup() {
  const repo = vi.mocked(new AuthRepo({} as Database));
  const tx = {} as Transaction;
  const transaction = vi.spyOn(repo, 'transaction').mockImplementation((work) => work(repo, tx));
  const lockIdentity = vi.spyOn(repo, 'lockIdentity').mockResolvedValue();
  const findByProviderId = vi.spyOn(repo, 'findByProviderId').mockResolvedValue(user());
  const lockUser = vi.spyOn(repo, 'lockUser').mockResolvedValue(user());
  const updateContact = vi.spyOn(repo, 'updateContact').mockResolvedValue();
  const linkWallets = vi.spyOn(repo, 'linkWallets').mockResolvedValue();
  const createSession = vi.spyOn(repo, 'createSession').mockResolvedValue({} as never);
  const createUser = vi.spyOn(repo, 'createUser').mockResolvedValue(user());
  const setSuspended = vi
    .spyOn(repo, 'setSuspended')
    .mockImplementation((_id, disabledAt) => Promise.resolve(user(disabledAt)));
  const revokeAllSessions = vi.spyOn(repo, 'revokeAllSessions').mockResolvedValue();
  const audit = vi.fn().mockResolvedValue(undefined);
  const identity = {
    verify: vi
      .fn()
      .mockResolvedValue({ providerUserId: 'test-provider', phone: '+2348012345678', wallets: [] }),
  };
  const rateLimit = { consume: vi.fn().mockResolvedValue({ allowed: true }) };
  const events = new EventEmitter2();
  const emit = vi.spyOn(events, 'emit');
  const service = new AuthService(
    repo,
    identity,
    rateLimit as unknown as RateLimitService,
    events,
    { audit } as unknown as AdminService,
  );
  const request = {
    admin: { id: 'admin-id' },
    ip: '127.0.0.1',
    get: () => 'test-agent',
  } as unknown as AdminRequest;
  return {
    spies: {
      transaction,
      lockIdentity,
      findByProviderId,
      lockUser,
      updateContact,
      linkWallets,
      createSession,
      createUser,
      setSuspended,
      revokeAllSessions,
    },
    tx,
    audit,
    service,
    request,
    identity,
    rateLimit,
    emit,
  };
}

describe('user access management', () => {
  let fixture: ReturnType<typeof setup>;
  beforeEach(() => {
    fixture = setup();
  });

  it('rejects suspended identities before any writes or session creation', async () => {
    const { spies, service, emit } = fixture;
    vi.mocked(spies.findByProviderId).mockResolvedValue(user(now));
    await expect(service.signIn('verified-token')).rejects.toBeInstanceOf(ForbiddenException);
    expect(spies.updateContact).not.toHaveBeenCalled();
    expect(spies.linkWallets).not.toHaveBeenCalled();
    expect(spies.createSession).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('preserves returning-user sign-in and hashes its session token', async () => {
    const { spies, service, emit } = fixture;
    const result = await service.signIn('verified-token');
    expect(result.isNew).toBe(false);
    expect(spies.lockIdentity).toHaveBeenCalledWith('test-provider');
    expect(spies.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user().id,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits a new-user event only after the transaction commits', async () => {
    const { spies, service, emit } = fixture;
    vi.mocked(spies.findByProviderId).mockResolvedValue(undefined);
    const result = await service.signIn('verified-token');
    expect(result.isNew).toBe(true);
    expect(emit).toHaveBeenCalledWith('auth.user.created', { userId: user().id });
    expect(vi.mocked(spies.createSession).mock.invocationCallOrder[0]).toBeLessThan(
      emit.mock.invocationCallOrder[0]!,
    );
  });

  it('does not emit an event when session creation fails', async () => {
    const { spies, service, emit } = fixture;
    vi.mocked(spies.findByProviderId).mockResolvedValue(undefined);
    vi.mocked(spies.createSession).mockRejectedValue(new Error('database unavailable'));
    await expect(service.signIn('verified-token')).rejects.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });

  it('returns a 429 before verifying an identity when rate limited', async () => {
    const { service, identity, rateLimit } = fixture;
    rateLimit.consume.mockResolvedValue({ allowed: false });
    const error = (await service.signIn('token').catch((error: unknown) => error)) as HttpException;
    expect(error.getStatus()).toBe(429);
    expect(identity.verify).not.toHaveBeenCalled();
  });

  it('suspends and audits the before/after state and reason in the same transaction', async () => {
    const { service, request, spies, audit, tx } = fixture;
    const result = await service.changeSuspension(user().id, true, 'Safety review', request);
    expect(result.disabledAt).not.toBeNull();
    expect(spies.revokeAllSessions).toHaveBeenCalledWith(user().id);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.suspend',
        adminUserId: 'admin-id',
        subjectId: user().id,
        before: { disabledAt: null },
        after: { disabledAt: expect.any(Date), reason: 'Safety review' },
        ip: '127.0.0.1',
      }),
      tx,
    );
    expect(JSON.stringify(audit.mock.calls)).not.toContain(user().phone);
  });

  it('reinstates without restoring any old session', async () => {
    const { service, request, spies, audit } = fixture;
    vi.mocked(spies.lockUser).mockResolvedValue(user(now));
    const result = await service.changeSuspension(user().id, false, 'Review complete', request);
    expect(result.disabledAt).toBeNull();
    expect(spies.revokeAllSessions).toHaveBeenCalled();
    expect(spies.createSession).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.reinstate' }),
      fixture.tx,
    );
  });

  it.each([true, false])('rejects an already-applied state (%s)', async (suspend) => {
    const { service, request, spies, audit } = fixture;
    vi.mocked(spies.lockUser).mockResolvedValue(user(suspend ? now : null));
    await expect(
      service.changeSuspension(user().id, suspend, 'Reason', request),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(spies.setSuspended).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('returns not found before changing or revealing a missing user', async () => {
    const { service, request, spies, audit } = fixture;
    vi.mocked(spies.lockUser).mockRejectedValue(new NotFoundException());
    await expect(
      service.changeSuspension(user().id, true, 'Reason', request),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.revealPhone(user().id, request)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit).not.toHaveBeenCalled();
  });

  it('does not return a phone if its audit write fails', async () => {
    const { service, request, audit } = fixture;
    audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(service.revealPhone(user().id, request)).rejects.toThrow('audit unavailable');
  });

  it('audits a reveal without copying the phone into the audit record', async () => {
    const { service, request, audit, tx } = fixture;
    await expect(service.revealPhone(user().id, request)).resolves.toEqual({ phone: user().phone });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.phone.reveal', subjectId: user().id }),
      tx,
    );
    expect(JSON.stringify(audit.mock.calls)).not.toContain(user().phone);
  });

  it('returns only the public admin-list projection', () => {
    const item = toUserItem(user());
    expect(item).toEqual({
      id: user().id,
      maskedPhone: '•••• 5678',
      kycVerified: false,
      createdAt: now.toISOString(),
      lastLoginAt: now.toISOString(),
      disabledAt: null,
    });
    expect(item).not.toHaveProperty('email');
    expect(item).not.toHaveProperty('providerUserId');
    expect(item).not.toHaveProperty('dateOfBirth');
  });

  it('handles missing phone and timestamps', () => {
    expect(toUserItem({ ...user(), phone: null, lastLoginAt: null })).toMatchObject({
      maskedPhone: null,
      lastLoginAt: null,
    });
  });
});

describe('user management validation', () => {
  it('defaults to 25 newest users', () => {
    expect(usersQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
      status: 'all',
      sort: 'createdAt',
      direction: 'desc',
    });
  });
  it.each([
    { page: 0 },
    { page: 1.2 },
    { page: 1000001 },
    { pageSize: 101 },
    { pageSize: 0 },
    { sort: 'phone' },
    { status: 'deleted' },
    { direction: 'random' },
  ])('rejects invalid query %j', (query) => {
    expect(usersQuerySchema.safeParse(query).success).toBe(false);
  });
  it('coerces pagination query strings', () => {
    expect(usersQuerySchema.parse({ page: '2', pageSize: '50' })).toMatchObject({
      page: 2,
      pageSize: 50,
    });
  });
  it.each(['', '   ', 'x'.repeat(1001)])('rejects invalid reasons', (reason) => {
    expect(reasonSchema.safeParse({ reason }).success).toBe(false);
  });
  it('trims the reason', () => {
    expect(reasonSchema.parse({ reason: ' Review complete ' })).toEqual({
      reason: 'Review complete',
    });
  });
});
