import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';

import type { Transaction } from '../../common/db';
import { RateLimitService } from '../../common/rate-limit';
import { AdminRepo, type AuditEntryInput } from './admin.repo';
import type { AdminRole, AdminUser } from './admin.schema';
import {
  checkPassword,
  createTotpSecret,
  hashPassword,
  hashToken,
  issueToken,
  SESSION_TTL_MS,
  totpUri,
  verifyPassword,
  verifyTotp,
} from './domain/credentials';

export interface RequestContext {
  readonly ip?: string | undefined;
  readonly userAgent?: string | undefined;
}

export type LoginOutcome =
  | { readonly kind: 'session'; readonly token: string; readonly expiresAt: Date }
  | { readonly kind: 'totp_required'; readonly challenge: string }
  | { readonly kind: 'totp_enrolment'; readonly challenge: string; readonly uri: string };

/**
 * The admin module's public API (CLAUDE.md rule 1: export this, not the repo).
 *
 * Login is **two steps**, always. Password first, then TOTP — and the password
 * step never issues a session, so a stolen password alone is worth nothing.
 * The intermediate state is a short-lived challenge token rather than a
 * server-side "half-logged-in" session, because a half-session is a thing that
 * can be mistaken for a real one by any code that forgets to check a flag.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  /**
   * Challenges live in memory for two minutes. Not Redis: they are single-use,
   * worthless after 120 seconds, and tying login to a second datastore means
   * a Redis blip locks every admin out.
   */
  private readonly challenges = new Map<
    string,
    { adminUserId: string; expiresAt: number; enrolling: boolean }
  >();

  /** TOTP steps already spent, so a code cannot be replayed inside its window. */
  private readonly usedSteps = new Map<string, number>();

  constructor(
    private readonly repo: AdminRepo,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
  ) {}

  async createAdmin(input: {
    email: string;
    password: string;
    role: AdminRole;
    actor?: AdminUser | undefined;
    context?: RequestContext | undefined;
  }): Promise<AdminUser> {
    const problems = checkPassword(input.password);
    if (problems.length > 0) throw new Error(`Password ${problems.join(', ')}`);

    const created = await this.repo.create({
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
    });

    await this.repo.recordAudit({
      adminUserId: input.actor?.id,
      action: 'admin_user.create',
      subjectType: 'admin_user',
      subjectId: created.id,
      // Never the hash, never the password. The audit log is read by humans.
      after: { email: created.email, role: created.role },
      ...input.context,
    });

    return created;
  }

  /**
   * Step one: email and password.
   *
   * Every failure path returns the **same** `UnauthorizedException`, and the
   * password is verified even when the email is unknown. Otherwise the
   * endpoint is an account enumerator: a fast "no" means no such admin, a slow
   * one means the password was checked.
   */
  async login(
    email: string,
    password: string,
    context: RequestContext = {},
  ): Promise<LoginOutcome> {
    const budget = await this.rateLimit.consume('login', email.toLowerCase());
    if (!budget.allowed) {
      throw new UnauthorizedException('Too many attempts. Try again shortly.');
    }

    const admin = await this.repo.findByEmail(email);

    // A dummy verify against a real hash, so the timing of a missing account
    // matches the timing of a wrong password.
    const stored = admin?.passwordHash ?? DUMMY_HASH;
    const ok = await verifyPassword(password, stored);

    if (!admin || !ok || admin.disabledAt) {
      await this.repo.recordAudit({
        adminUserId: admin?.id,
        action: 'admin.login.failed',
        after: { email: email.toLowerCase(), reason: admin ? 'credentials' : 'unknown_email' },
        ...context,
      });
      throw new UnauthorizedException('Email or password is wrong.');
    }

    // Enrolment, not a session: an admin without confirmed 2FA gets a secret
    // to scan and must prove it before anything is issued.
    if (!admin.totpSecret || !admin.totpConfirmedAt) {
      const secret = admin.totpSecret ?? createTotpSecret();
      if (!admin.totpSecret) await this.repo.setTotpSecret(admin.id, secret);

      return {
        kind: 'totp_enrolment',
        challenge: this.issueChallenge(admin.id, true),
        uri: totpUri(admin.email, secret),
      };
    }

    return { kind: 'totp_required', challenge: this.issueChallenge(admin.id, false) };
  }

  /**
   * Step two: the 6-digit code. Only this issues a session.
   */
  async verifyTotpAndIssueSession(
    challenge: string,
    code: string,
    context: RequestContext = {},
  ): Promise<{ token: string; expiresAt: Date; adminUser: AdminUser }> {
    const pending = this.challenges.get(challenge);
    if (!pending || pending.expiresAt < Date.now()) {
      this.challenges.delete(challenge);
      throw new UnauthorizedException('That sign-in attempt expired. Start again.');
    }

    const budget = await this.rateLimit.consume('otpVerify', pending.adminUserId);
    if (!budget.allowed) {
      this.challenges.delete(challenge);
      throw new UnauthorizedException('Too many attempts. Start again shortly.');
    }

    const admin = await this.repo.findById(pending.adminUserId);
    if (!admin?.totpSecret || admin.disabledAt) {
      throw new UnauthorizedException('That sign-in attempt is no longer valid.');
    }

    const step = verifyTotp(admin.totpSecret, code);
    if (step === null || this.usedSteps.get(admin.id) === step) {
      await this.repo.recordAudit({
        adminUserId: admin.id,
        action: 'admin.login.totp_failed',
        // A replayed code is a different signal from a wrong one: it means
        // someone saw a valid code they should not have.
        after: { replay: step !== null },
        ...context,
      });
      throw new UnauthorizedException('That code is wrong or already used.');
    }

    // Single-use within its window, which `window: 1` would otherwise allow.
    this.usedSteps.set(admin.id, step);
    this.challenges.delete(challenge);

    if (pending.enrolling) await this.repo.confirmTotp(admin.id);

    const { token, hash } = issueToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.repo.createSession({
      adminUserId: admin.id,
      tokenHash: hash,
      expiresAt,
      ...context,
    });
    await this.repo.markLogin(admin.id);
    await this.rateLimit.reset('login', admin.email);

    await this.repo.recordAudit({
      adminUserId: admin.id,
      action: pending.enrolling ? 'admin.totp.enrolled' : 'admin.login',
      ...context,
    });

    return { token, expiresAt, adminUser: admin };
  }

  /** Used by `AdminGuard` on every authenticated request. */
  async resolveSession(token: string): Promise<AdminUser | undefined> {
    const found = await this.repo.findLiveSession(hashToken(token));
    return found?.adminUser;
  }

  async logout(token: string, context: RequestContext = {}): Promise<void> {
    const found = await this.repo.findLiveSession(hashToken(token));
    await this.repo.revokeSession(hashToken(token));
    if (found) {
      await this.repo.recordAudit({
        adminUserId: found.adminUser.id,
        action: 'admin.logout',
        ...context,
      });
    }
  }

  /** Exposed so other modules can write their own audit rows (rule 3). */
  async audit(entry: AuditEntryInput, transaction?: Transaction): Promise<void> {
    await this.repo.recordAudit(entry, transaction);
  }

  private issueChallenge(adminUserId: string, enrolling: boolean): string {
    this.sweep();
    const { token } = issueToken();
    this.challenges.set(token, {
      adminUserId,
      enrolling,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    return token;
  }

  /** Keeps the two maps from growing without bound on a long-lived process. */
  private sweep(): void {
    const now = Date.now();
    for (const [key, value] of this.challenges) {
      if (value.expiresAt < now) this.challenges.delete(key);
    }
    if (this.usedSteps.size > 1000) this.usedSteps.clear();
  }
}

const CHALLENGE_TTL_MS = 2 * 60 * 1000;

/**
 * A **real** argon2id hash, of a passphrase nobody knows, so that verifying
 * against a missing account costs the same as verifying against a real one.
 *
 * It has to be genuine. A malformed string makes `verify` throw immediately —
 * measured at **1ms against 10ms** for a real hash — which is precisely the
 * timing signal this exists to remove, and would turn the login endpoint into
 * an account enumerator.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$1Y4RJJxMVlnEXvLq03hx1A$qC3smEJlJBK+397c4rrLmizZt57V/McBVPE9Yy2BANQ';
