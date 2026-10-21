import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Env } from '../../common/config';
import { documentBirthDate, evaluateEvidence, type ProviderEvidence } from './domain/verification';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;

/** Never persist or log this object: Youverify reports can contain IDs and images. */
export function readYouverifyEvidence(raw: unknown): ProviderEvidence {
  const report = object(raw);
  const fields = Array.isArray(report?.fields) ? report.fields : [];
  const identities = fields.map(object).filter((field) => field?.__type === 'identity');
  const identity = identities.length === 1 ? identities[0] : undefined;
  const result = object(identity?.report);
  const validations = object(result?.validations);
  const selfie = object(object(validations?.selfie)?.selfieVerification);
  const birth = result?.dateOfBirth;
  const dateOfBirth =
    typeof birth === 'string' && /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.\d+)?Z)?$/.test(birth)
      ? birth.slice(0, 10)
      : undefined;
  const validBirth = documentBirthDate(dateOfBirth);
  const checkedIdentity =
    identity?.validated === true &&
    identity.status === 'found' &&
    result?.status === 'found' &&
    result.allValidationPassed === true &&
    selfie?.match === true &&
    validBirth !== undefined &&
    typeof report?.completedVerifications === 'number' &&
    report.completedVerifications > 0;
  const approved = report?.status === 'cleared' && checkedIdentity;
  return {
    resultCode: typeof report?.status === 'string' ? report.status : 'unknown',
    approved,
    rejected: report?.status === 'not_cleared' || identity?.status === 'not_found',
    // A DOB from a typed form field or an unverified ID cannot prove underage.
    dateOfBirth: checkedIdentity ? dateOfBirth : undefined,
  };
}

export function assessYouverifyReport(raw: unknown, now = new Date()) {
  return evaluateEvidence(readYouverifyEvidence(raw), now);
}

/** Server-only report client. The API key never crosses the KYC boundary. */
@Injectable()
export class YouverifyClient {
  constructor(@Inject(CONFIG) private readonly env: Env) {}

  async report(responseId: string): Promise<unknown> {
    if (!this.env.YOUVERIFY_API_KEY || !this.env.YOUVERIFY_VFORM_ID)
      throw new Error('Youverify KYC is not configured.');
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(responseId))
      throw new Error('Invalid Youverify response ID.');
    const url = new URL(
      `/v2/api/v-forms/${encodeURIComponent(this.env.YOUVERIFY_VFORM_ID)}/responses/${encodeURIComponent(responseId)}`,
      this.env.YOUVERIFY_BASE_URL,
    );
    const response = await fetch(url, {
      headers: { token: this.env.YOUVERIFY_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`Youverify report request failed (${String(response.status)}).`);
    const envelope = object(await response.json());
    const data = object(envelope?.data);
    if (envelope?.success !== true || data?._id !== responseId)
      throw new Error('Youverify returned an invalid report.');
    if (data.templateId !== this.env.YOUVERIFY_VFORM_ID)
      throw new Error('Youverify report belongs to a different form.');
    return data;
  }
}
