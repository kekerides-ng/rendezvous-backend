import { relations } from 'drizzle-orm';
import { index, jsonb, pgSchema, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, reference, timestamps } from '../../common/db/columns';

/**
 * The admin module's tables, in their own Postgres schema (architecture.md §3).
 *
 * Completely separate from user auth: no wallet, no phone, no shared session.
 * An admin compromise and a user compromise should have nothing in common,
 * and sharing a `users` table is how "log in as any user" becomes one bug away.
 */
export const adminSchema = pgSchema('admin');

export const adminRole = adminSchema.enum('admin_role', ['admin', 'moderator']);

export const adminUsers = adminSchema.table(
  'admin_users',
  {
    id: id(),
    email: text('email').notNull(),
    /** argon2id. Never a hash this app can reverse, obviously, but also never logged. */
    passwordHash: text('password_hash').notNull(),

    /**
     * The TOTP secret, base32. Null until enrolment completes — an admin can
     * exist before they have set up 2FA, which is the window `totpConfirmedAt`
     * below is there to close.
     */
    totpSecret: text('totp_secret'),
    /**
     * Set when the admin first proves they can produce a code. Until then the
     * secret is provisional: generated and shown, but not yet accepted. Without
     * this an admin who scans the QR, loses the phone, and never completes
     * enrolment is locked out with a secret the system thinks is live.
     */
    totpConfirmedAt: timestamp('totp_confirmed_at', { withTimezone: true }),

    role: adminRole('role').notNull().default('moderator'),
    /** Set to disable without deleting — an audit trail needs the row to stay. */
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [uniqueIndex('admin_users_email_key').on(table.email)],
);

export const adminSessions = adminSchema.table(
  'admin_sessions',
  {
    id: id(),
    adminUserId: reference('admin_user_id').notNull(),

    /**
     * A **hash** of the session token, never the token.
     *
     * The cookie holds a random opaque string; this holds its SHA-256. Anyone
     * who reads this table — a leaked backup, an over-broad query in a support
     * tool — gets nothing they can present as a session. It is the same
     * reasoning as storing a password hash, for the same kind of secret.
     */
    tokenHash: text('token_hash').notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    /** Context for the audit trail: where a session was created from. */
    ip: text('ip'),
    userAgent: text('user_agent'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('admin_sessions_token_hash_key').on(table.tokenHash),
    index('admin_sessions_admin_user_id_idx').on(table.adminUserId),
  ],
);

/**
 * Every admin action: who, what, before, after, when, IP (architecture.md §4).
 *
 * Append-only by convention — nothing in this module updates or deletes a row,
 * and a reviewer should treat any code that does as a bug. An audit log that
 * can be edited by the people it audits is decoration.
 */
export const auditLog = adminSchema.table(
  'audit_log',
  {
    id: id(),
    /** Null for a failed login: there is no authenticated actor yet, and the
     * attempt is exactly the thing worth recording. */
    adminUserId: reference('admin_user_id'),
    /** `admin.login`, `profile.hide`, `dispute.resolve`. */
    action: text('action').notNull(),
    /** What was acted on: `profile`, `booking`, `admin_user`. */
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),

    /** State either side of the change. Null where the action has no state. */
    before: jsonb('before'),
    after: jsonb('after'),

    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_admin_user_id_idx').on(table.adminUserId),
    index('audit_log_action_idx').on(table.action),
    index('audit_log_subject_idx').on(table.subjectType, table.subjectId),
    index('audit_log_created_at_idx').on(table.createdAt),
  ],
);

/**
 * Platform settings an admin can change without a deploy — the fee, category
 * limits, booking windows (architecture.md §7.1).
 *
 * Key/value with a jsonb payload rather than a column per setting, because the
 * alternative is a migration every time a number needs tuning.
 */
export const settings = adminSchema.table(
  'settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    updatedByAdminId: reference('updated_by_admin_id'),
    ...timestamps(),
  },
  (table) => [index('settings_updated_by_idx').on(table.updatedByAdminId)],
);

/**
 * Within one module, real foreign keys are fine — these are all `admin.*`
 * tables. Across modules they are not (`DECISIONS.md` I15), which is why
 * `auditLog.subjectId` is a bare text column rather than a reference: it points
 * at rows in whatever module the action touched.
 */
export const adminSessionsRelations = relations(adminSessions, ({ one }) => ({
  adminUser: one(adminUsers, {
    fields: [adminSessions.adminUserId],
    references: [adminUsers.id],
  }),
}));

export const adminUsersRelations = relations(adminUsers, ({ many }) => ({
  sessions: many(adminSessions),
}));

export type AdminUser = typeof adminUsers.$inferSelect;
export type AdminSession = typeof adminSessions.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type AdminRole = (typeof adminRole.enumValues)[number];
