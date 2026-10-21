import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, lt, ne, or } from 'drizzle-orm';
import { DRIZZLE, type DbExecutor, type Transaction } from '../../common/db';
import type { KycStatus } from './domain/verification';
import { verifications } from './kyc.schema';

@Injectable()
export class KycRepo {
  constructor(@Inject(DRIZZLE) private readonly db: DbExecutor) {}

  async forUser(userId: string) {
    const [row] = await this.db
      .select()
      .from(verifications)
      .where(eq(verifications.userId, userId));
    return row;
  }

  /** Reserve one in-flight check per user before calling a billable provider. */
  async begin(userId: string): Promise<boolean> {
    const now = new Date();
    const [created] = await this.db
      .insert(verifications)
      .values({ userId, status: 'pending' })
      .onConflictDoNothing({ target: verifications.userId })
      .returning({ id: verifications.id });
    if (created) return true;
    const [restarted] = await this.db
      .update(verifications)
      .set({
        status: 'pending',
        resultCode: null,
        reason: null,
        adult: false,
        providerApproved: false,
        providerJobId: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(verifications.userId, userId),
          ne(verifications.status, 'verified'),
          ne(verifications.status, 'underage'),
          or(
            ne(verifications.status, 'pending'),
            lt(verifications.updatedAt, new Date(now.getTime() - 5 * 60_000)),
          ),
        ),
      )
      .returning({ id: verifications.id });
    return Boolean(restarted);
  }

  async complete(
    userId: string,
    input: {
      status: KycStatus;
      resultCode: string;
      reason: string;
      adult: boolean;
      providerApproved: boolean;
      providerJobId?: string;
    },
  ): Promise<void> {
    const [row] = await this.db
      .update(verifications)
      .set({
        status: input.status,
        resultCode: input.resultCode,
        reason: input.reason,
        adult: input.adult,
        providerApproved: input.providerApproved,
        providerJobId: input.providerJobId ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(verifications.userId, userId), eq(verifications.status, 'pending')))
      .returning({ id: verifications.id });
    if (!row) throw new NotFoundException('Pending verification not found.');
  }

  async queue(page: number, pageSize: number) {
    return this.db.transaction(
      async (tx) => {
        const where = eq(verifications.status, 'review');
        const [total] = await tx.select({ count: count() }).from(verifications).where(where);
        const items = await tx
          .select()
          .from(verifications)
          .where(where)
          .orderBy(asc(verifications.createdAt), asc(verifications.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize);
        return { items, total: total?.count ?? 0, page, pageSize };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async transaction<T>(work: (repo: KycRepo, tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new KycRepo(tx), tx));
  }

  async lock(id: string) {
    const [row] = await this.db
      .select()
      .from(verifications)
      .where(eq(verifications.id, id))
      .for('update');
    if (!row) throw new NotFoundException('Verification not found.');
    return row;
  }

  async reject(id: string, adminUserId: string) {
    const [row] = await this.db
      .update(verifications)
      .set({
        status: 'rejected',
        reason: 'review_rejected',
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(verifications.id, id))
      .returning();
    if (!row) throw new NotFoundException('Verification not found.');
    return row;
  }
}
