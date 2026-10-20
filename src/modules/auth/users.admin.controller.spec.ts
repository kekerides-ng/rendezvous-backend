import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { AdminGuard, type AdminRole, type AdminService } from '../admin';
import type { AdminRequest } from '../admin/admin.guard';
import { UsersAdminController } from './users.admin.controller';

function fixture(
  role: AdminRole | null,
  method: 'list' | 'reveal' | 'suspend' | 'reinstate',
  cookie = true,
) {
  const resolveSession = vi.fn().mockResolvedValue(role ? { id: 'admin-id', role } : undefined);
  const guard = new AdminGuard(new Reflector(), { resolveSession } as unknown as AdminService);
  const request = { cookies: cookie ? { rdv_admin_session: 'test-session' } : {} } as AdminRequest;
  const context = {
    getClass: () => UsersAdminController,
    getHandler: () =>
      Reflect.get(UsersAdminController.prototype, method) as (...args: never[]) => unknown,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { guard, context, request, resolveSession };
}

describe('admin users authorization', () => {
  it('guards the whole controller by default', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, UsersAdminController)).toContain(AdminGuard);
  });
  it.each(['list', 'reveal', 'suspend', 'reinstate'] as const)(
    'rejects anonymous %s',
    async (method) => {
      const { guard, context } = fixture(null, method, false);
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );
  it('rejects an expired session', async () => {
    const { guard, context } = fixture(null, 'list');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it.each(['list', 'reveal'] as const)('allows moderator %s', async (method) => {
    const { guard, context, request } = fixture('moderator', method);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.admin?.role).toBe('moderator');
  });
  it.each(['suspend', 'reinstate'] as const)('denies moderator %s with 403', async (method) => {
    const { guard, context } = fixture('moderator', method);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(['suspend', 'reinstate'] as const)('allows admin %s', async (method) => {
    const { guard, context } = fixture('admin', method);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
