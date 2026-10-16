import { describe, expect, it } from 'vitest';

import { HealthService } from './health';

const up = (name: string) => ({ name, check: async (): Promise<void> => undefined });
const down = (name: string) => ({
  name,
  check: async (): Promise<void> => {
    throw new Error('connection refused to postgres://user:secret@host/db');
  },
});

describe('HealthService', () => {
  it('liveness checks nothing external, so a dead dependency cannot restart us', async () => {
    const health = new HealthService();
    health.register(down('postgres'));
    expect(health.live()).toEqual({ status: 'ok' });
    const report = await health.ready();
    expect(report.status).toBe('not_ready');
  });

  it('is ready when every critical check passes', async () => {
    const health = new HealthService();
    health.register(up('postgres'), up('redis'));
    const report = await health.ready();
    expect(report.status).toBe('ready');
    expect(report.checks.map((c) => c.name)).toEqual(['postgres', 'redis']);
  });

  it('stays ready when a NON-critical check fails', async () => {
    const health = new HealthService();
    health.register(up('postgres'), { ...down('rates'), critical: false });
    const report = await health.ready();
    expect(report.status).toBe('ready');
    expect(report.checks.find((c) => c.name === 'rates')?.status).toBe('down');
  });

  it('truncates the error, because a connection error can carry credentials', async () => {
    const health = new HealthService();
    health.register(down('postgres'));
    const report = await health.ready();
    expect(report.checks[0]?.error?.length).toBeLessThanOrEqual(200);
  });

  it('fails a hanging check instead of hanging the probe', async () => {
    const health = new HealthService();
    health.register({
      name: 'wedged',
      check: () => new Promise<void>(() => undefined),
      timeoutMs: 20,
    });
    const report = await health.ready();
    expect(report.status).toBe('not_ready');
    expect(report.checks[0]?.error).toMatch(/timed out/);
  });

  it('is not ready while draining, even with every dependency healthy', async () => {
    const health = new HealthService();
    health.register(up('postgres'));
    health.beginShutdown();
    const report = await health.ready();
    expect(report.status).toBe('not_ready');
    expect(report.shuttingDown).toBe(true);
  });
});
