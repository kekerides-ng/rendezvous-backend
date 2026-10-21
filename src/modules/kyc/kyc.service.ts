import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RateLimitService } from '../../common/rate-limit';
import { AdminService } from '../admin';
import type { AdminRequest } from '../admin/admin.guard';
import { AuthService } from '../auth/auth.service';
import { documentBirthDate } from './domain/verification';
import { KycRepo } from './kyc.repo';
import type { Verification } from './kyc.schema';
import { assessNin, type NinCheck, YouverifyClient } from './youverify';

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
    private readonly rateLimit: RateLimitService,
    private readonly youverify: YouverifyClient,
  ) {}

  async status(userId: string) {
    const row = await this.repo.forUser(userId);
    return { status: row?.status ?? 'not_started' };
  }

  async verifyNin(userId: string, input: NinCheck & { consent: true }) {
    const budget = await this.rateLimit.consume('kycCheck', userId);
    if (!budget.allowed) throw new HttpException('Too many ID checks. Try again tomorrow.', 429);
    if (!(await this.repo.begin(userId)))
      throw new ConflictException('This identity check is already complete or in progress.');

    let raw: unknown;
    try {
      raw = await this.youverify.verifyNin(input);
    } catch {
      await this.repo.complete(userId, {
        status: 'review',
        resultCode: 'provider_error',
        reason: 'provider_unavailable',
        adult: false,
        providerApproved: false,
      });
      throw new ServiceUnavailableException('Identity check is unavailable. Please try again.');
    }

    const { evidence, assessment, providerJobId } = assessNin(raw, input);
    await this.repo.transaction(async (repo, tx) => {
      await repo.complete(userId, {
        ...assessment,
        resultCode: evidence.resultCode,
        providerApproved: evidence.approved,
        ...(providerJobId ? { providerJobId } : {}),
      });
      await this.auth.recordKycResult(
        userId,
        assessment.status === 'verified' ? (documentBirthDate(evidence.dateOfBirth) ?? null) : null,
        tx,
      );
    });
    return { status: assessment.status };
  }

  /** Future offer endpoints must enforce this server-side, not a client badge. */
  async requireVerifiedAdult(userId: string): Promise<void> {
    const row = await this.repo.forUser(userId);
    if (row?.status !== 'verified' || !row.adult || !row.providerApproved)
      throw new ForbiddenException(
        'Verify your identity and age before making or accepting an offer.',
      );
  }

  async queue(page: number, pageSize: number) {
    const result = await this.repo.queue(page, pageSize);
    return { ...result, items: result.items.map(reviewItem) };
  }

  /** Staff can reject evidence, but cannot override missing/failed identity or age proof. */
  async reject(id: string, reason: string, request: AdminRequest) {
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
