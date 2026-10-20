import { relations } from 'drizzle-orm';
import { index, pgSchema, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, reference, timestamps } from '../../common/db/columns';

/**
 * The auth module's tables (architecture.md §3, §4).
 *
 * Completely separate from `admin.*`. An admin compromise and a user
 * compromise should have nothing in common.
 */
export const authSchema = pgSchema('auth');

export const users = authSchema.table(
  'users',
  {
    id: id(),

    /**
     * Privy's own id for this person. The join key between their identity and
     * ours, and the thing that makes a returning user the same row.
     */
    providerUserId: text('provider_user_id').notNull(),

    /**
     * E.164, as Privy verified it. **Encrypted at column level before
     * production** (architecture.md §8, NDPA) — stored plain for now and
     * flagged, because pretending otherwise would be worse than saying so.
     */
    phone: text('phone'),
    email: text('email'),

    /** Set once KYC passes (step 1.3). Until then, no offers. */
    kycVerifiedAt: timestamp('kyc_verified_at', { withTimezone: true }),
    /** Only the age is ever shown, never the date (sign-up promises this). */
    dateOfBirth: timestamp('date_of_birth', { withTimezone: true }),

    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('users_provider_user_id_key').on(table.providerUserId),
    index('users_phone_idx').on(table.phone),
  ],
);

/**
 * A user can hold more than one wallet — an embedded one from Privy and an
 * external one they connected — so this is a table rather than a column.
 */
export const wallets = authSchema.table(
  'wallets',
  {
    id: id(),
    userId: reference('user_id').notNull(),
    /** Lower-cased on write: addresses are case-insensitive, and a mixed-case
     * duplicate would defeat the unique index. */
    address: text('address').notNull(),

    /**
     * The chain FAMILY — `ethereum` or `solana` — not a chain id.
     *
     * An EVM address is not chain-specific: the same address holds funds on
     * Base, Ethereum and Polygon alike, so a per-wallet chain id would be
     * recording something that is not a property of the wallet. Which chain we
     * actually settle on comes from `CHAIN_ID` in config.
     *
     * What the family does tell us is whether a wallet can hold our USDC at
     * all — a Solana address cannot, and that is worth being able to see.
     */
    chainType: text('chain_type').notNull().default('ethereum'),
    /** `embedded` (Privy custodies it) or `external` (the user's own). */
    kind: text('kind').notNull().default('embedded'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('wallets_address_key').on(table.address),
    index('wallets_user_id_idx').on(table.userId),
  ],
);

/**
 * Our own sessions, not Privy's.
 *
 * architecture.md §4: the backend verifies the provider's token once and then
 * issues its own cookie. Privy vouches that a phone number is real; it never
 * owns our session. That is what keeps swapping providers to one function.
 */
export const sessions = authSchema.table(
  'sessions',
  {
    id: id(),
    userId: reference('user_id').notNull(),
    /** SHA-256 of the token, never the token (DECISIONS I17). */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  wallets: many(wallets),
  sessions: many(sessions),
}));

export const walletsRelations = relations(wallets, ({ one }) => ({
  user: one(users, { fields: [wallets.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type Wallet = typeof wallets.$inferSelect;
export type Session = typeof sessions.$inferSelect;
