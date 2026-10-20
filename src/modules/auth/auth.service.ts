import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { RateLimitService } from '../../common/rate-limit';
import { hashToken, issueToken } from '../admin/domain/credentials';
import { AuthRepo } from './auth.repo';
import type { User } from './auth.schema';
import { IDENTITY_PROVIDER, type IdentityProvider } from './domain/identity-provider';

/** A user session lasts longer than an admin's: this is a consumer app. */
export const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface RequestContext {
  readonly ip?: string | undefined;
  readonly userAgent?: string | undefined;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepo,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly rateLimit: RateLimitService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Exchange a provider token for **our** session.
   *
   * One method, used for both sign-up and sign-in, because from here they are
   * the same event: a verified identity arrives and either matches a row or
   * creates one. The distinction the screens draw is a product one, and
   * making it a backend one would mean two paths that must stay identical.
   */
  async signIn(
    providerToken: string,
    context: RequestContext = {},
  ): Promise<{ token: string; expiresAt: Date; user: User; isNew: boolean }> {
    // Keyed on IP here, not on a user id — we do not know who this is yet, and
    // the thing being limited is someone grinding tokens at the endpoint.
    const budget = await this.rateLimit.consume('login', context.ip ?? 'unknown');
    if (!budget.allowed) {
      throw new Error('Too many attempts. Try again shortly.');
    }

    const identity = await this.identity.verify(providerToken);

    const existing = await this.repo.findByProviderId(identity.providerUserId);
    const user =
      existing ??
      (await this.repo.createUser({
        providerUserId: identity.providerUserId,
        phone: identity.phone,
        email: identity.email,
      }));

    // A number or email can change at the provider between logins.
    await this.repo.updateContact(user.id, { phone: identity.phone, email: identity.email });
    await this.repo.linkWallets(user.id, identity.wallets);

    const { token, hash } = issueToken();
    const expiresAt = new Date(Date.now() + USER_SESSION_TTL_MS);
    await this.repo.createSession({ userId: user.id, tokenHash: hash, expiresAt, ...context });

    if (!existing) {
      // Other modules react without this one knowing they exist (rule 1).
      this.events.emit('auth.user.created', { userId: user.id });
    }

    return { token, expiresAt, user, isNew: !existing };
  }

  /** Used by `SessionGuard` on every authenticated request. */
  async resolveSession(token: string): Promise<User | undefined> {
    const found = await this.repo.findLiveSession(hashToken(token));
    return found?.user;
  }

  async signOut(token: string): Promise<void> {
    await this.repo.revokeSession(hashToken(token));
  }

  async walletsFor(userId: string) {
    return this.repo.walletsFor(userId);
  }
}
