import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';

import { DRIZZLE, type DbExecutor, type Transaction } from '../../common/db';
import { type Session, type User, sessions, users, wallets } from './auth.schema';

/** The ONLY place that touches `auth.*` tables (CLAUDE.md rule 1). */
@Injectable()
export class AuthRepo {
  constructor(@Inject(DRIZZLE) private readonly db: DbExecutor) {}

  async transaction<T>(work: (repo: AuthRepo, transaction: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction((transaction) => work(new AuthRepo(transaction), transaction));
  }

  /** Serialize first sign-ins too, before there is a user row to lock. */
  async lockIdentity(providerId: string): Promise<void> {
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${providerId}, 0))`);
  }

  async lockUser(id: string): Promise<User> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).for('update');
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  async listUsers(input: {
    page: number;
    pageSize: number;
    status: string;
    sort: 'createdAt' | 'lastLoginAt';
    direction: 'asc' | 'desc';
  }) {
    const where =
      input.status === 'active'
        ? isNull(users.disabledAt)
        : input.status === 'suspended'
          ? isNotNull(users.disabledAt)
          : undefined;
    const column = input.sort === 'createdAt' ? users.createdAt : users.lastLoginAt;
    const order = input.direction === 'asc' ? asc(column) : desc(column);
    return this.db.transaction(
      async (tx) => {
        const [total] = await tx.select({ count: count() }).from(users).where(where);
        const items = await tx
          .select()
          .from(users)
          .where(where)
          .orderBy(sql`${order} nulls last`, asc(users.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize);
        return { items, total: total?.count ?? 0, page: input.page, pageSize: input.pageSize };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async setSuspended(id: string, disabledAt: Date | null): Promise<User> {
    const [user] = await this.db
      .update(users)
      .set({ disabledAt, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async findByProviderId(providerUserId: string): Promise<User | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.providerUserId, providerUserId))
      .limit(1)
      .for('update');
    return row;
  }

  async createUser(input: {
    providerUserId: string;
    phone?: string | undefined;
    email?: string | undefined;
  }): Promise<User> {
    const [row] = await this.db.insert(users).values(input).returning();
    if (!row) throw new Error('users insert returned nothing');
    return row;
  }

  /** Called on every login: a number or email can change at the provider. */
  async updateContact(
    id: string,
    input: { phone?: string | undefined; email?: string | undefined },
  ): Promise<void> {
    await this.db
      .update(users)
      .set({ ...input, lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  /**
   * Idempotent on address: a wallet already linked to this user is a no-op,
   * and one linked to somebody else is left alone — the unique index means
   * the insert would fail, and silently reassigning a wallet between accounts
   * is the kind of thing that moves money to the wrong person.
   */
  async linkWallets(
    userId: string,
    incoming: readonly { address: string; chainType: string; kind: string }[],
  ): Promise<void> {
    if (incoming.length === 0) return;
    await this.db
      .insert(wallets)
      .values(incoming.map((wallet) => ({ ...wallet, userId })))
      .onConflictDoNothing({ target: wallets.address });
  }

  async walletsFor(userId: string) {
    return this.db.select().from(wallets).where(eq(wallets.userId, userId));
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ip?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<Session> {
    const [row] = await this.db.insert(sessions).values(input).returning();
    if (!row) throw new Error('sessions insert returned nothing');
    return row;
  }

  /** Live sessions only, and never for a disabled user. */
  async findLiveSession(tokenHash: string): Promise<{ user: User } | undefined> {
    const [row] = await this.db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          isNull(users.disabledAt),
        ),
      )
      .limit(1);
    return row;
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
  }

  async recordKycResult(userId: string, birth: Date | null): Promise<void> {
    await this.db
      .update(users)
      .set({
        kycVerifiedAt: birth ? new Date() : null,
        dateOfBirth: birth,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }
}
