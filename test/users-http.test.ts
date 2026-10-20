import type { Server } from 'node:http';

import { type INestApplication, ForbiddenException } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppExceptionFilter } from '../src/common/http/exception.filter';
import { API_PREFIX_EXCLUSIONS, openApiConfig } from '../src/common/http/openapi';
import { AdminGuard, AdminService } from '../src/modules/admin';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { SessionGuard } from '../src/modules/auth/session.guard';
import { UsersAdminController } from '../src/modules/auth/users.admin.controller';
import { inject } from './request-without-listener';

const id = '019a0123-4567-7123-8123-123456789abc';
const item = {
  id,
  maskedPhone: '•••• 5678',
  kycVerified: false,
  createdAt: '2026-10-20T10:00:00Z',
  lastLoginAt: null,
  disabledAt: null,
};
const auth = {
  listUsers: vi.fn(),
  changeSuspension: vi.fn(),
  revealPhone: vi.fn(),
  signIn: vi.fn(),
};

describe('users HTTP contract (no TCP listener)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UsersAdminController, AuthController],
      providers: [
        AdminGuard,
        SessionGuard,
        { provide: AuthService, useValue: auth },
        {
          provide: AdminService,
          useValue: {
            resolveSession: (token: string) =>
              token === 'admin' || token === 'moderator'
                ? Promise.resolve({ id, role: token })
                : Promise.resolve(undefined),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new AppExceptionFilter());
    app.setGlobalPrefix('v1', { exclude: API_PREFIX_EXCLUSIONS });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    auth.listUsers.mockResolvedValue({ items: [item], total: 1, page: 1, pageSize: 25 });
    auth.changeSuspension.mockResolvedValue(item);
    auth.revealPhone.mockResolvedValue({ phone: '+2348012345678' });
  });
  const send = (input: Parameters<typeof inject>[1]) =>
    inject(app.getHttpServer() as Server, input);

  it('serves the unversioned route and parses pagination with an admin cookie', async () => {
    const response = await send({
      path: '/admin/users?page=2&pageSize=50&status=active&sort=lastLoginAt&direction=asc',
      cookie: 'rdv_admin_session=admin',
    });
    expect(response.status).toBe(200);
    expect(auth.listUsers).toHaveBeenCalledWith({
      page: 2,
      pageSize: 50,
      status: 'active',
      sort: 'lastLoginAt',
      direction: 'asc',
    });
    expect(response.body).toMatchObject({ items: [item] });
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('does not put admin routes under /v1', async () => {
    expect(
      (await send({ path: '/v1/admin/users', cookie: 'rdv_admin_session=admin' })).status,
    ).toBe(404);
  });
  it('requires the admin cookie, not the user cookie', async () => {
    expect((await send({ path: '/admin/users', cookie: 'rdv_session=admin' })).status).toBe(401);
    expect(auth.listUsers).not.toHaveBeenCalled();
  });
  it.each(['suspend', 'reinstate'])(
    'rejects a moderator attempting %s with 403',
    async (action) => {
      const response = await send({
        path: `/admin/users/${id}/${action}`,
        method: 'POST',
        cookie: 'rdv_admin_session=moderator',
        body: { reason: 'Review' },
      });
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      expect(auth.changeSuspension).not.toHaveBeenCalled();
    },
  );
  it('allows a moderator to reveal a phone', async () => {
    const response = await send({
      path: `/admin/users/${id}/reveal-phone`,
      method: 'POST',
      cookie: 'rdv_admin_session=moderator',
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ phone: '+2348012345678' });
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('validates reasons before invoking the service', async () => {
    const response = await send({
      path: `/admin/users/${id}/suspend`,
      method: 'POST',
      cookie: 'rdv_admin_session=admin',
      body: { reason: '   ' },
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(auth.changeSuspension).not.toHaveBeenCalled();
  });
  it('trims the reason and passes the authenticated actor', async () => {
    const response = await send({
      path: `/admin/users/${id}/suspend`,
      method: 'POST',
      cookie: 'rdv_admin_session=admin',
      body: { reason: ' Review ' },
    });
    expect(response.status).toBe(200);
    expect(auth.changeSuspension).toHaveBeenCalledWith(
      id,
      true,
      'Review',
      expect.objectContaining({ admin: { id, role: 'admin' } }),
    );
  });
  it('rejects malformed IDs and invalid pagination', async () => {
    expect(
      (
        await send({
          path: '/admin/users/not-an-id/reinstate',
          method: 'POST',
          cookie: 'rdv_admin_session=admin',
          body: { reason: 'Review' },
        })
      ).status,
    ).toBe(400);
    expect(
      (await send({ path: '/admin/users?pageSize=101', cookie: 'rdv_admin_session=admin' })).status,
    ).toBe(400);
  });
  it('never sets a session cookie for a suspended sign-in', async () => {
    auth.signIn.mockRejectedValue(new ForbiddenException('Your account is suspended.'));
    const response = await send({
      path: '/v1/auth/sign-in',
      method: 'POST',
      body: { providerToken: 'verified-token' },
    });
    expect(response.status).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
  it('documents the routes, permission errors and masked list shape in Swagger', () => {
    const spec = SwaggerModule.createDocument(app, openApiConfig());
    expect(spec.paths['/admin/users/{id}/suspend']?.post?.responses).toHaveProperty('403');
    expect(spec.paths['/v1/auth/sign-in']?.post?.responses).toHaveProperty('403');
    const schema = spec.components?.schemas?.UserItemDto;
    expect(schema).toHaveProperty('properties.maskedPhone');
    expect(schema).not.toHaveProperty('properties.phone');
    expect(schema).not.toHaveProperty('properties.dateOfBirth');
  });
});
