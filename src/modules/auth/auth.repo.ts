import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { DRIZZLE, type Database } from '../../common/db';
import { type Session, type User, sessions, users, wallets } from './auth.schema';

/** The ONLY place that touches `auth.*` tables (CLAUDE.md rule 1). */
@Injectable()
export class AuthRepo {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findByProviderId(providerUserId: string): Promise<User | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.providerUserId, providerUserId))
      .limit(1);
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
}
