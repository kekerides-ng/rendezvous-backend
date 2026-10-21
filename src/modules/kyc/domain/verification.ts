/** Verification policy is independent of Nest, databases and provider SDKs. */
export const KYC_STATUSES = ['pending', 'review', 'verified', 'rejected', 'underage'] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

/** Only unambiguous calendar dates are accepted; JS's date rollover is unsafe here. */
export function documentBirthDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? date
    : undefined;
}

/** Age is evaluated on the calendar date in Lagos, including the whole birthday. */
export function isAdult(birth: Date, now = new Date()): boolean {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (name: string) => Number(today.find((item) => item.type === name)?.value);
  const years = part('year') - birth.getUTCFullYear();
  const birthdayPassed =
    part('month') > birth.getUTCMonth() + 1 ||
    (part('month') === birth.getUTCMonth() + 1 && part('day') >= birth.getUTCDate());
  return years > 18 || (years === 18 && birthdayPassed);
}

export interface ProviderEvidence {
  readonly resultCode: string;
  readonly approved: boolean;
  readonly rejected: boolean;
  readonly dateOfBirth?: string | undefined;
}

export function evaluateEvidence(
  evidence: ProviderEvidence,
  now = new Date(),
): {
  status: KycStatus;
  adult: boolean;
  reason: string;
} {
  const birth = documentBirthDate(evidence.dateOfBirth);
  if (birth && birth > now) return { status: 'review', adult: false, reason: 'invalid_birth_date' };
  if (birth && !isAdult(birth, now))
    return { status: 'underage', adult: false, reason: 'under_18' };
  if (evidence.rejected) return { status: 'rejected', adult: false, reason: 'provider_rejected' };
  if (!birth) return { status: 'review', adult: false, reason: 'missing_birth_date' };
  if (!evidence.approved) return { status: 'review', adult: true, reason: 'provider_review' };
  return { status: 'verified', adult: true, reason: 'verified_adult' };
}
