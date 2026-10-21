import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../common/config';
import { assessYouverifyReport, readYouverifyEvidence, YouverifyClient } from './youverify';

const adultReport = {
  _id: 'response123',
  templateId: 'form123',
  status: 'cleared',
  completedVerifications: 1,
  fields: [
    {
      __type: 'identity',
      status: 'found',
      validated: true,
      report: {
        status: 'found',
        dateOfBirth: '2000-01-01',
        allValidationPassed: true,
        validations: { selfie: { selfieVerification: { match: true } } },
      },
    },
  ],
};

describe('Youverify report policy', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  it('approves a cleared adult only with checked ID and selfie', () => {
    expect(assessYouverifyReport(adultReport, now).status).toBe('verified');
  });
  it('does not approve an empty cleared form', () => {
    expect(
      assessYouverifyReport({ status: 'cleared', completedVerifications: 0 }, now).status,
    ).toBe('review');
  });
  it('does not trust a typed birth date or a failed selfie', () => {
    const failed = structuredClone(adultReport);
    failed.fields[0]!.report.validations.selfie.selfieVerification.match = false;
    expect(readYouverifyEvidence(failed).dateOfBirth).toBeUndefined();
    expect(assessYouverifyReport(failed, now).status).toBe('review');
  });
  it('requires a unique verified identity', () => {
    const duplicate = { ...adultReport, fields: [...adultReport.fields, ...adultReport.fields] };
    expect(assessYouverifyReport(duplicate, now).status).toBe('review');
  });
  it('blocks a proved minor', () => {
    const minor = structuredClone(adultReport);
    minor.fields[0]!.report.dateOfBirth = '2010-01-01';
    expect(assessYouverifyReport(minor, now).status).toBe('underage');
  });
  it('does not mistake a malformed timestamp for a birth date', () => {
    const bad = structuredClone(adultReport);
    bad.fields[0]!.report.dateOfBirth = '2000-01-01not-a-date';
    expect(assessYouverifyReport(bad, now).status).toBe('review');
  });
});

describe('Youverify report client', () => {
  const env = {
    YOUVERIFY_API_KEY: 'test-only',
    YOUVERIFY_VFORM_ID: 'form123',
    YOUVERIFY_BASE_URL: 'https://api.sandbox.youverify.co',
  } as Env;
  it('calls the sandbox with the secret header and checks form ownership', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: adultReport }),
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      expect(await new YouverifyClient(env).report('response123')).toEqual(adultReport);
      expect(fetcher).toHaveBeenCalledWith(
        new URL('https://api.sandbox.youverify.co/v2/api/v-forms/form123/responses/response123'),
        expect.objectContaining({ headers: { token: 'test-only', Accept: 'application/json' } }),
      );
      await expect(new YouverifyClient(env).report('../other')).rejects.toThrow('Invalid');
      fetcher.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { ...adultReport, templateId: 'other' } }),
      });
      await expect(new YouverifyClient(env).report('response123')).rejects.toThrow(
        'different form',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
