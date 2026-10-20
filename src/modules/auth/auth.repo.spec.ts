import { EventEmitter2 } from '@nestjs/event-emitter';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { RateLimitService } from '../../common/rate-limit';
import { AdminRepo } from '../admin/admin.repo';
import type { AdminRequest } from '../admin/admin.guard';
import { AdminService } from '../admin/admin.service';
import { AuthRepo } from './auth.repo';
import { AuthService } from './auth.service';
import { usersQuerySchema } from './dto/users.dto';

const id = '019a0123-4567-7123-8123-123456789abc';
const date = '2026-10-20T10:00:00Z';
const row = [id, 'provider', '+2348012345678', null, null, null, null, date, date, date];

/** Exercise Drizzle's real SQL and transaction driver without a listening database. */
function driver(failAudit = false) {
  const statements: { text: string; values: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (query: string | { text: string }, values: unknown[] = []) => {
      const text = typeof query === 'string' ? query : query.text;
      statements.push({ text, values });
      if (text.includes('insert into "admin"."audit_log"') && failAudit)
        throw new Error('audit storage failed');
      if (text.includes('count(*)')) return { rows: [[1]] };
      if (text.startsWith('select') && text.includes('from "auth"."users"')) return { rows: [row] };
      if (text.startsWith('update "auth"."users"'))
        return { rows: [[...row.slice(0, 6), date, ...row.slice(7)]] };
      return { rows: [] };
    }),
  };
  const db = drizzle(client as unknown as Pool);
  return { db, repo: new AuthRepo(db), statements };
}

describe('auth repository transactions and queries', () => {
  it('locks the user before updating access and revoking sessions', async () => {
    const { repo, statements } = driver();
    await repo.transaction(async (txRepo) => {
      await txRepo.lockUser(id);
      await txRepo.setSuspended(id, new Date());
      await txRepo.revokeAllSessions(id);
    });
    const sql = statements.map((statement) => statement.text);
    expect(sql[0]).toBe('begin');
    expect(sql[1]).toContain('for update');
    expect(sql[2]).toContain('update "auth"."users"');
    expect(sql[3]).toContain('update "auth"."sessions"');
    expect(sql.at(-1)).toBe('commit');
  });

  it('rolls back the suspension and session revocation when the shared audit write fails', async () => {
    const { repo, db, statements } = driver(true);
    const admins = new AdminService(new AdminRepo(db), {} as RateLimitService);
    const service = new AuthService(
      repo,
      { verify: vi.fn() },
      {} as RateLimitService,
      new EventEmitter2(),
      admins,
    );
    const request = {
      admin: { id },
      ip: '127.0.0.1',
      get: () => 'agent',
    } as unknown as AdminRequest;
    await expect(service.changeSuspension(id, true, 'Safety review', request)).rejects.toThrow();
    const sql = statements.map((statement) => statement.text);
    expect(sql).toContainEqual(expect.stringContaining('update "auth"."sessions"'));
    expect(sql).toContainEqual(expect.stringContaining('insert into "admin"."audit_log"'));
    expect(sql.at(-1)).toBe('rollback');
    expect(sql).not.toContain('commit');
  });

  it('commits the audit on the same connection as the suspension', async () => {
    const { repo, db, statements } = driver();
    const admins = new AdminService(new AdminRepo(db), {} as RateLimitService);
    const service = new AuthService(
      repo,
      { verify: vi.fn() },
      {} as RateLimitService,
      new EventEmitter2(),
      admins,
    );
    const request = { admin: { id }, get: () => 'agent' } as unknown as AdminRequest;
    await service.changeSuspension(id, true, 'Safety review', request);
    const sql = statements.map((statement) => statement.text);
    expect(sql.filter((text) => text === 'begin')).toHaveLength(1);
    expect(sql.at(-2)).toContain('insert into "admin"."audit_log"');
    expect(sql.at(-1)).toBe('commit');
    expect(JSON.stringify(statements.at(-2))).toContain('Safety review');
    expect(JSON.stringify(statements.at(-2))).not.toContain('+2348012345678');
  });

  it('locks the same user row during sign-in lookup', async () => {
    const { repo, statements } = driver();
    await repo.transaction(async (txRepo) => {
      await txRepo.lockIdentity('provider-id');
      await txRepo.findByProviderId('provider-id');
    });
    expect(statements[1]?.text).toContain('pg_advisory_xact_lock');
    expect(statements[1]?.values).toEqual(['provider-id']);
    expect(statements[2]?.text).toContain('for update');
  });

  it('checks disabled status, session revocation and expiry on every request', async () => {
    const { repo, statements } = driver();
    await repo.findLiveSession('token-hash');
    expect(statements[0]?.text).toContain('"auth"."users"."disabled_at" is null');
    expect(statements[0]?.text).toContain('"auth"."sessions"."revoked_at" is null');
    expect(statements[0]?.text).toContain('"auth"."sessions"."expires_at" >');
  });

  it('uses a consistent snapshot for count and page, filters and stable sorting', async () => {
    const { repo, statements } = driver();
    const page = await repo.listUsers(
      usersQuerySchema.parse({
        status: 'suspended',
        sort: 'lastLoginAt',
        direction: 'asc',
        page: '2',
        pageSize: '25',
      }),
    );
    expect(page.total).toBe(1);
    expect(statements[0]?.text).toContain('isolation level repeatable read read only');
    expect(statements[1]?.text).toContain('"auth"."users"."disabled_at" is not null');
    expect(statements[2]?.text).toContain(
      'order by "auth"."users"."last_login_at" asc nulls last, "auth"."users"."id" asc',
    );
    expect(statements[2]?.values).toEqual([25, 25]);
  });
});
