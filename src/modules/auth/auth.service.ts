import {
  Inject,
  Injectable,
  ForbiddenException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { RateLimitService } from '../../common/rate-limit';
import { hashToken, issueToken } from '../admin/domain/credentials';
import { AdminService } from '../admin';
import { type AdminRequest } from '../admin/admin.guard';
import { type UsersQuery, toUserItem } from './dto/users.dto';
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
    private readonly admins: AdminService,
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
      throw new HttpException('Too many attempts. Try again shortly.', 429);
    }

    const identity = await this.identity.verify(providerToken);

    const { token, hash } = issueToken();
    const expiresAt = new Date(Date.now() + USER_SESSION_TTL_MS);
    const { user, isNew } = await this.repo.transaction(async (repo) => {
      await repo.lockIdentity(identity.providerUserId);
      const existing = await repo.findByProviderId(identity.providerUserId);
      if (existing?.disabledAt) throw new ForbiddenException('Your account is suspended.');
      const user =
        existing ??
        (await repo.createUser({
          providerUserId: identity.providerUserId,
          phone: identity.phone,
          email: identity.email,
        }));
      await repo.updateContact(user.id, { phone: identity.phone, email: identity.email });
      await repo.linkWallets(user.id, identity.wallets);
      await repo.createSession({ userId: user.id, tokenHash: hash, expiresAt, ...context });
      return { user, isNew: !existing };
    });

    if (isNew) {
      // Other modules react without this one knowing they exist (rule 1).
      this.events.emit('auth.user.created', { userId: user.id });
    }

    return { token, expiresAt, user, isNew };
  }

  async listUsers(query: UsersQuery) {
    const result = await this.repo.listUsers(query);
    return { ...result, items: result.items.map(toUserItem) };
  }

  async revealPhone(id: string, request: AdminRequest) {
    return this.repo.transaction(async (repo, tx) => {
      const user = await repo.lockUser(id);
      await this.admins.audit(
        {
          adminUserId: request.admin?.id,
          action: 'user.phone.reveal',
          subjectType: 'user',
          subjectId: id,
          ip: request.ip,
          userAgent: request.get('user-agent'),
        },
        tx,
      );
      return { phone: user.phone };
    });
  }

  async changeSuspension(id: string, suspend: boolean, reason: string, request: AdminRequest) {
    return this.repo.transaction(async (repo, tx) => {
      const before = await repo.lockUser(id);
      if ((before.disabledAt !== null) === suspend)
        throw new ConflictException(
          suspend ? 'User is already suspended.' : 'User is already active.',
        );
      const after = await repo.setSuspended(id, suspend ? new Date() : null);
      // Revoke on both paths: even historical suspended-user sessions must stay dead.
      await repo.revokeAllSessions(id);
      await this.admins.audit(
        {
          adminUserId: request.admin?.id,
          action: suspend ? 'user.suspend' : 'user.reinstate',
          subjectType: 'user',
          subjectId: id,
          before: { disabledAt: before.disabledAt },
          after: { disabledAt: after.disabledAt, reason },
          ip: request.ip,
          userAgent: request.get('user-agent'),
        },
        tx,
      );
      return toUserItem(after);
    });
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
