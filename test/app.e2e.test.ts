import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inject } from './request-without-listener';
import { API_PREFIX_EXCLUSIONS } from '../src/common/http/openapi';
import { AppModule } from '../src/app.module';
import { AppExceptionFilter } from '../src/common/http/exception.filter';
import type { ReadinessReport } from '../src/common/http/health';

/**
 * This test exists as much for the TOOLCHAIN as for the routes.
 *
 * Building the real AppModule forces Nest to resolve every provider from
 * decorator metadata. Vitest transforms TypeScript with esbuild, which does not
 * emit that metadata — so without the swc plugin in vitest.config.mts this test
 * fails with "Nest can't resolve dependencies of HealthModule (?)", and every
 * later e2e test in the project fails the same way. If this one is green, DI
 * works under the test runner.
 */
describe('app (e2e)', () => {
  let app: INestApplication;

  // `getHttpServer()` is typed `any`, so it is narrowed once here rather than
  // at seven call sites.
  const server = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalFilters(new AppExceptionFilter());
    app.setGlobalPrefix('v1', { exclude: API_PREFIX_EXCLUSIONS });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves liveness unconditionally', async () => {
    const response = await inject(server(), { path: '/health/live' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('reports every registered dependency on readiness', async () => {
    const response = await inject(server(), { path: '/health' });
    // 200 with docker compose up, 503 without — either is correct behaviour.
    expect([200, 503]).toContain(response.status);
    const report = response.body as ReadinessReport;
    expect(report.checks.map((check) => check.name).sort()).toEqual(['postgres', 'redis']);
  });

  it('keeps KYC status and review endpoints behind their separate sessions', async () => {
    expect((await inject(server(), { path: '/v1/kyc' })).status).toBe(401);
    expect((await inject(server(), { path: '/admin/kyc' })).status).toBe(401);
    expect((await inject(server(), { path: '/v1/admin/kyc' })).status).toBe(404);
  });

  it('echoes the request id the caller sent', async () => {
    const response = await inject(server(), {
      path: '/health/live',
      headers: { 'x-request-id': 'trace-me-123' },
    });
    expect(response.headers['x-request-id']).toBe('trace-me-123');
  });

  it('mints a request id when the caller sends none', async () => {
    const response = await inject(server(), { path: '/health/live' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the ApiError shape for an unknown route', async () => {
    const response = await inject(server(), { path: '/v1/does-not-exist' });
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      code: 'NOT_FOUND',
      requestId: expect.any(String) as unknown,
    });
  });

  it('keeps health OUTSIDE the /v1 prefix, so clients pin /v1 without breaking probes', async () => {
    expect((await inject(server(), { path: '/v1/health' })).status).toBe(404);
    expect((await inject(server(), { path: '/health/live' })).status).toBe(200);
  });
});
