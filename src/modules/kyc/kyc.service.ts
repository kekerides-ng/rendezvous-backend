import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Env } from '../../common/config';
import { AdminService } from '../admin';
import type { AdminRequest } from '../admin/admin.guard';
import { AuthService } from '../auth/auth.service';
import { KycRepo } from './kyc.repo';
import type { Verification } from './kyc.schema';

const reviewItem = (row: Verification) => ({
  id: row.id,
  userId: row.userId,
  status: row.status,
  resultCode: row.resultCode,
  reason: row.reason,
  adult: row.adult,
  providerApproved: row.providerApproved,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class KycService {
  constructor(
    private readonly repo: KycRepo,
    private readonly admins: AdminService,
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly env: Env,
  ) {}

  async status(userId: string) {
    if (this.env.KYC_PROVIDER === 'off') return { status: 'not_started', provider: 'off' };
    const row = await this.repo.forUser(userId);
    return { status: row?.status ?? 'not_started', provider: this.env.KYC_PROVIDER };
  }

  /** Future offer endpoints must enforce this server-side, not a client badge. */
  async requireVerifiedAdult(userId: string): Promise<void> {
    if (this.env.KYC_PROVIDER === 'off')
      throw new ForbiddenException('Identity verification is paused. Plans are unavailable.');
    const row = await this.repo.forUser(userId);
    if (row?.status !== 'verified' || !row.adult || !row.providerApproved)
      throw new ForbiddenException(
        'Verify your identity and age before making or accepting an offer.',
      );
  }

  async queue(page: number, pageSize: number) {
    if (this.env.KYC_PROVIDER === 'off') return { items: [], total: 0, page, pageSize };
    const result = await this.repo.queue(page, pageSize);
    return { ...result, items: result.items.map(reviewItem) };
  }

  /** Staff can reject evidence, but cannot override missing/failed identity or age proof. */
  async reject(id: string, reason: string, request: AdminRequest) {
    if (this.env.KYC_PROVIDER === 'off')
      throw new ForbiddenException('Identity verification is paused.');
    if (!request.admin) throw new ForbiddenException('Not signed in.');
    const actorId = request.admin.id;
    return this.repo.transaction(async (repo, tx) => {
      const before = await repo.lock(id);
      if (before.status !== 'review')
        throw new ConflictException('This verification is no longer awaiting review.');
      const after = await repo.reject(id, actorId);
      await this.auth.recordKycResult(before.userId, null, tx);
      await this.admins.audit(
        {
          adminUserId: actorId,
          action: 'kyc.reject',
          subjectType: 'verification',
          subjectId: id,
          before: { status: before.status },
          after: { status: after.status, reason },
          ip: request.ip,
          userAgent: request.get('user-agent'),
        },
        tx,
      );
      return reviewItem(after);
    });
  }
}
