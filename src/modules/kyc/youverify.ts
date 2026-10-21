import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CONFIG, type Env } from '../../common/config';
import { documentBirthDate, evaluateEvidence, type ProviderEvidence } from './domain/verification';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;

export interface NinCheck {
  nin: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  selfie: string;
}

/** Extract only decisions and the provider's opaque check ID. Never retain the raw response. */
export function readNinEvidence(
  raw: unknown,
  input: NinCheck,
): {
  evidence: ProviderEvidence;
  providerJobId?: string | undefined;
} {
  const envelope = object(raw);
  const data = object(envelope?.data);
  const validations = object(data?.validations);
  const fields = object(validations?.data);
  const selfie = object(object(validations?.selfie)?.selfieVerification);
  const checked =
    envelope?.success === true &&
    data?.status === 'found' &&
    data.country === 'NG' &&
    data.type === 'nin' &&
    data.idNumber === input.nin &&
    data.isConsent === true &&
    data.dataValidation === true &&
    data.selfieValidation === true &&
    data.allValidationPassed === true &&
    object(fields?.firstName)?.validated === true &&
    object(fields?.lastName)?.validated === true &&
    object(fields?.dateOfBirth)?.validated === true &&
    selfie?.match === true &&
    typeof data.dateOfBirth === 'string' &&
    documentBirthDate(data.dateOfBirth) !== undefined &&
    data.dateOfBirth === input.dateOfBirth;
  const rejected = data?.status === 'not_found' || selfie?.match === false;
  return {
    evidence: {
      resultCode: typeof data?.status === 'string' ? data.status : 'unknown',
      approved: checked,
      rejected,
      // A typed DOB, or one attached to an unproven ID, does not prove age.
      dateOfBirth: checked ? input.dateOfBirth : undefined,
    },
    providerJobId:
      typeof data?.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(data.id) ? data.id : undefined,
  };
}

export function assessNin(raw: unknown, input: NinCheck, now = new Date()) {
  const result = readNinEvidence(raw, input);
  return { ...result, assessment: evaluateEvidence(result.evidence, now) };
}

/** Quick Check uses the server secret, never the browser's public merchant key. */
@Injectable()
export class YouverifyClient {
  constructor(@Inject(CONFIG) private readonly env: Env) {}

  async verifyNin(input: NinCheck): Promise<unknown> {
    if (!this.env.YOUVERIFY_API_KEY)
      throw new ServiceUnavailableException('Identity verification is not configured.');
    const url = new URL('/v2/api/identity/ng/nin', this.env.YOUVERIFY_BASE_URL);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          token: this.env.YOUVERIFY_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          id: input.nin,
          isSubjectConsent: true,
          validations: {
            data: {
              firstName: input.firstName,
              lastName: input.lastName,
              dateOfBirth: input.dateOfBirth,
            },
            selfie: { image: input.selfie },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ServiceUnavailableException('Identity provider is temporarily unavailable.');
    }
    if (!response.ok)
      throw new ServiceUnavailableException('Identity provider could not complete the check.');
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ServiceUnavailableException('Identity provider returned an invalid result.');
    }
    if (object(raw)?.success !== true || !object(object(raw)?.data))
      throw new ServiceUnavailableException('Identity provider returned an invalid result.');
    return raw;
  }
}
