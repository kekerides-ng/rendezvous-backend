import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, count, eq } from 'drizzle-orm';
import { DRIZZLE, type DbExecutor, type Transaction } from '../../common/db';
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
