import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import { DRIZZLE, type Database, type Transaction } from '../../common/db';
import {
  type AdminRole,
  type AdminSession,
  type AdminUser,
  adminSessions,
  adminUsers,
  auditLog,
} from './admin.schema';

/**
 * What an audit row needs.
 *
 * Every optional field is `| undefined` explicitly, because `tsconfig` has
 * `exactOptionalPropertyTypes` on: without it, spreading a context object
 * whose `ip` happens to be undefined is a type error at every call site.
 */
export interface AuditEntryInput {
  adminUserId?: string | undefined;
  action: string;
  subjectType?: string | undefined;
  subjectId?: string | undefined;
  before?: unknown;
  after?: unknown;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * The ONLY place that touches `admin.*` tables (CLAUDE.md rule 1).
 *
 * Everything returns plain rows; decisions live in the service. The split is
 * what lets the service be tested against a fake repo without a database.
 */
@Injectable()
export class AdminRepo {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findByEmail(email: string): Promise<AdminUser | undefined> {
    const [row] = await this.db
      .select()
      .from(adminUsers)
      // Lower-cased on both sides: an admin who signs up as `Ada@…` and logs
      // in as `ada@…` is the same person, and email is case-insensitive in
      // practice whatever the RFC allows.
      .where(eq(sql`lower(${adminUsers.email})`, email.toLowerCase()))
      .limit(1);
    return row;
  }

  async findById(id: string): Promise<AdminUser | undefined> {
    const [row] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
    return row;
  }

  async create(input: {
    email: string;
    passwordHash: string;
    role: AdminRole;
  }): Promise<AdminUser> {
    const [row] = await this.db
      .insert(adminUsers)
      .values({ ...input, email: input.email.toLowerCase() })
      .returning();
    if (!row) throw new Error('admin_users insert returned nothing');
    return row;
  }

  async setTotpSecret(id: string, secret: string): Promise<void> {
    // Provisional until confirmed: clearing `totpConfirmedAt` means a restarted
    // enrolment cannot leave an old secret live.
    await this.db
      .update(adminUsers)
      .set({ totpSecret: secret, totpConfirmedAt: null, updatedAt: new Date() })
      .where(eq(adminUsers.id, id));
  }

  async confirmTotp(id: string): Promise<void> {
    await this.db
      .update(adminUsers)
      .set({ totpConfirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(adminUsers.id, id));
  }

  async markLogin(id: string): Promise<void> {
    await this.db
      .update(adminUsers)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(adminUsers.id, id));
  }

  async createSession(input: {
    adminUserId: string;
    tokenHash: string;
    expiresAt: Date;
    ip?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<AdminSession> {
    const [row] = await this.db.insert(adminSessions).values(input).returning();
    if (!row) throw new Error('admin_sessions insert returned nothing');
    return row;
  }

  /** Live sessions only: not revoked, not expired. */
  async findLiveSession(
    tokenHash: string,
  ): Promise<{ session: AdminSession; adminUser: AdminUser } | undefined> {
    const [row] = await this.db
      .select({ session: adminSessions, adminUser: adminUsers })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminSessions.adminUserId, adminUsers.id))
      .where(
        and(
          eq(adminSessions.tokenHash, tokenHash),
          isNull(adminSessions.revokedAt),
          gt(adminSessions.expiresAt, new Date()),
          // A disabled admin's existing sessions die immediately, rather than
          // lasting until they expire.
          isNull(adminUsers.disabledAt),
        ),
      )
      .limit(1);
    return row;
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.db
      .update(adminSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(adminSessions.tokenHash, tokenHash), isNull(adminSessions.revokedAt)));
  }

  /** Every session for one admin — used when disabling or resetting 2FA. */
  async revokeAllSessions(adminUserId: string): Promise<void> {
    await this.db
      .update(adminSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(adminSessions.adminUserId, adminUserId), isNull(adminSessions.revokedAt)));
  }

  /** Append-only. Nothing in this module updates or deletes an audit row. */
  async recordAudit(entry: AuditEntryInput, transaction?: Transaction): Promise<void> {
    await (transaction ?? this.db).insert(auditLog).values(entry);
  }

  async recentAudit(limit = 50) {
    return this.db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
  }
}
