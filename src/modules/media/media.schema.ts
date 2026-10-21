import { index, integer, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import { id, reference, timestamps } from '../../common/db/columns';

export const mediaSchema = pgSchema('media');
export type MediaStatus = 'uploading' | 'pending_review' | 'approved' | 'rejected' | 'deleted';

export const assets = mediaSchema.table(
  'assets',
  {
    id: id(),
    userId: reference('user_id').notNull(),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    status: text('status').$type<MediaStatus>().notNull().default('uploading'),
    reason: text('reason'),
    reviewedBy: reference('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index('media_user_created_idx').on(table.userId, table.createdAt),
    index('media_status_created_idx').on(table.status, table.createdAt),
  ],
);

export type Asset = typeof assets.$inferSelect;
