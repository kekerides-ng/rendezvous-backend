import { boolean, index, pgSchema, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { id, reference, timestamps } from '../../common/db/columns';
import type { KycStatus } from './domain/verification';

export const kycSchema = pgSchema('kyc');
/** Never persist ID images, image links, ID numbers or raw provider payloads. */
export const verifications = kycSchema.table(
  'verifications',
  {
    id: id(),
    userId: reference('user_id').notNull(),
    providerUserId: text('provider_user_id').notNull(),
  providerJobId: text('provider_job_id'),
    status: text('status').$type<KycStatus>().notNull().default('pending'),
    resultCode: text('result_code'),
    reason: text('reason'),
    adult: boolean('adult').notNull().default(false),
    providerApproved: boolean('provider_approved').notNull().default(false),
    reviewedBy: reference('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('kyc_user_key').on(table.userId),
  uniqueIndex('kyc_provider_job_key').on(table.providerJobId),
    index('kyc_status_created_idx').on(table.status, table.createdAt),
  ],
);
export type Verification = typeof verifications.$inferSelect;
