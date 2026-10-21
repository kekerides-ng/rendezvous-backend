import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import { DRIZZLE, type DbExecutor, type Transaction } from '../../common/db';
import { assets, type Asset, type MediaStatus } from './media.schema';

@Injectable()
export class MediaRepo {
  constructor(@Inject(DRIZZLE) private readonly db: DbExecutor) {}

  async transaction<T>(work: (repo: MediaRepo, tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new MediaRepo(tx), tx));
  }

  async reserve(
    userId: string,
    objectKey: string,
    contentType: string,
    bytes: number,
  ): Promise<Asset> {
    return this.db.transaction(async (tx) => {
      // Serialize simultaneous reservations for one user, so both cannot see five slots.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
      const [current] = await tx
        .select({ count: count() })
        .from(assets)
        .where(
          and(
            eq(assets.userId, userId),
            inArray(assets.status, ['uploading', 'pending_review', 'approved']),
            // An abandoned upload reservation cannot occupy a slot forever.
            sql`(${assets.status} <> 'uploading' or ${assets.createdAt} > now() - interval '1 hour')`,
          ),
        );
      if ((current?.count ?? 0) >= 6) throw new ConflictException('You can have up to six photos.');
      const [row] = await tx
        .insert(assets)
        .values({ userId, objectKey, contentType, bytes })
        .returning();
      if (!row) throw new Error('Media reservation returned no row.');
      return row;
    });
  }

  async forUser(userId: string) {
    return this.db
      .select()
      .from(assets)
      .where(and(eq(assets.userId, userId), ne(assets.status, 'deleted')))
      .orderBy(asc(assets.createdAt), asc(assets.id));
  }

  async owned(id: string, userId: string): Promise<Asset> {
    const [row] = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.userId, userId)));
    if (!row || row.status === 'deleted') throw new NotFoundException('Photo not found.');
    return row;
  }

  async lock(id: string): Promise<Asset> {
    const [row] = await this.db.select().from(assets).where(eq(assets.id, id)).for('update');
    if (!row || row.status === 'deleted') throw new NotFoundException('Photo not found.');
    return row;
  }

  async setStatus(id: string, status: MediaStatus, reviewedBy?: string, reason?: string) {
    const [row] = await this.db
      .update(assets)
      .set({
        status,
        reviewedBy,
        reason,
        reviewedAt: reviewedBy ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, id))
      .returning();
    if (!row) throw new NotFoundException('Photo not found.');
    return row;
  }

  async queue(page: number, pageSize: number) {
    return this.db.transaction(
      async (tx) => {
        const where = eq(assets.status, 'pending_review');
        const [total] = await tx.select({ count: count() }).from(assets).where(where);
        const items = await tx
          .select()
          .from(assets)
          .where(where)
          .orderBy(asc(assets.createdAt), asc(assets.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize);
        return { items, total: total?.count ?? 0, page, pageSize };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
