import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../common/config';
import { assessNin, type NinCheck, YouverifyClient } from './youverify';

const input: NinCheck = {
  nin: '11111111111',
  firstName: 'Ada',
  lastName: 'Okonkwo',
  dateOfBirth: '1990-04-04',
  selfie: 'data:image/jpeg;base64,YWJj',
};
const found = {
  success: true,
  data: {
    id: 'check123',
    status: 'found',
    country: 'NG',
    type: 'nin',
    idNumber: input.nin,
    isConsent: true,
    dataValidation: true,
    selfieValidation: true,
    allValidationPassed: true,
    dateOfBirth: input.dateOfBirth,
    validations: {
      data: {
        firstName: { validated: true },
        lastName: { validated: true },
        dateOfBirth: { validated: true },
      },
      selfie: { selfieVerification: { match: true } },
    },
  },
};
const now = new Date('2026-10-21T12:00:00Z');

describe('direct NIN assessment', () => {
  it('verifies only the provider-checked adult with a matching selfie', () => {
    expect(assessNin(found, input, now).assessment.status).toBe('verified');
    expect(assessNin(found, input, now).providerJobId).toBe('check123');
  });
  it.each([
    { dataValidation: false },
    { selfieValidation: false },
    { allValidationPassed: false },
    { idNumber: '22222222222' },
    { country: 'KE' },
    { dateOfBirth: '2000-01-01' },
    {
      validations: { ...found.data.validations, selfie: { selfieVerification: { match: false } } },
    },
    {
      validations: {
        ...found.data.validations,
        data: { ...found.data.validations.data, dateOfBirth: { validated: false } },
      },
    },
  ])('cannot approve incomplete or mismatched proof (%j)', (change) => {
    const result = assessNin({ ...found, data: { ...found.data, ...change } }, input, now);
    expect(result.assessment.status).not.toBe('verified');
    expect(result.evidence.dateOfBirth).toBeUndefined();
  });
  it('blocks a minor only when that DOB is provider-checked', () => {
    const minorInput = { ...input, dateOfBirth: '2010-04-04' };
    const minor = { ...found, data: { ...found.data, dateOfBirth: minorInput.dateOfBirth } };
    expect(assessNin(minor, minorInput, now).assessment.status).toBe('underage');
  });
});

describe('Youverify Quick Check client', () => {
  const env = {
    YOUVERIFY_API_KEY: 'test-only',
    YOUVERIFY_BASE_URL: 'https://api.sandbox.youverify.co',
  } as Env;
  it('uses the documented sandbox route, secret header, and explicit consent', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => found });
    vi.stubGlobal('fetch', fetcher);
    try {
      expect(await new YouverifyClient(env).verifyNin(input)).toEqual(found);
      const [url, options] = fetcher.mock.calls[0] as [URL, RequestInit];
      expect(url.href).toBe('https://api.sandbox.youverify.co/v2/api/identity/ng/nin');
      expect(options.headers).toEqual(expect.objectContaining({ token: 'test-only' }));
      expect(JSON.parse(options.body as string)).toEqual({
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
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('does not expose provider response details on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    try {
      await expect(new YouverifyClient(env).verifyNin(input)).rejects.toThrow(
        'Identity provider could not complete the check.',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
