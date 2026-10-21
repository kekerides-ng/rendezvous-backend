import { describe, expect, it } from 'vitest';
import { documentBirthDate, evaluateEvidence, isAdult } from './verification';

describe('verified document age policy', () => {
  it.each(['2000-02-30', '2001-02-29', '01/02/2000', '', 'tomorrow', '2000-13-01'])(
    'rejects invalid or ambiguous DOB %s',
    (value) => {
      expect(documentBirthDate(value)).toBeUndefined();
    },
  );
  it('accepts leap-day birth dates', () => {
    expect(documentBirthDate('2000-02-29')?.toISOString()).toBe('2000-02-29T00:00:00.000Z');
  });
  it('turns 18 on the Lagos birthday rather than UTC midnight', () => {
    const birth = new Date('2008-10-21T00:00:00Z');
    expect(isAdult(birth, new Date('2026-10-20T22:59:59Z'))).toBe(false);
    expect(isAdult(birth, new Date('2026-10-20T23:00:00Z'))).toBe(true);
  });
  it('handles leap-day birthdays conservatively on March 1 in a non-leap year', () => {
    const birth = new Date('2008-02-29T00:00:00Z');
    expect(isAdult(birth, new Date('2026-02-28T12:00:00Z'))).toBe(false);
    expect(isAdult(birth, new Date('2026-03-01T12:00:00Z'))).toBe(true);
  });
  const now = new Date('2026-10-21T12:00:00Z');
  it('does not trust an approved provider result without document DOB', () => {
    expect(
      evaluateEvidence({ resultCode: 'pass', approved: true, rejected: false }, now).status,
    ).toBe('review');
  });
  it('never lets an approved provider result bypass 18+', () => {
    expect(
      evaluateEvidence(
        { resultCode: 'pass', approved: true, rejected: false, dateOfBirth: '2010-01-01' },
        now,
      ).status,
    ).toBe('underage');
  });
  it('accepts only an approved adult', () => {
    expect(
      evaluateEvidence(
        { resultCode: 'pass', approved: true, rejected: false, dateOfBirth: '2000-01-01' },
        now,
      ).status,
    ).toBe('verified');
  });
  it('leaves an adult provisional result in review', () => {
    expect(
      evaluateEvidence(
        { resultCode: 'provisional', approved: false, rejected: false, dateOfBirth: '2000-01-01' },
        now,
      ).status,
    ).toBe('review');
  });
  it('rejects failed identity evidence even with adult DOB', () => {
    expect(
      evaluateEvidence(
        { resultCode: 'fail', approved: false, rejected: true, dateOfBirth: '2000-01-01' },
        now,
      ).status,
    ).toBe('rejected');
  });
  it('never accepts a future DOB', () => {
    expect(
      evaluateEvidence(
        { resultCode: 'pass', approved: true, rejected: false, dateOfBirth: '2030-01-01' },
        now,
      ).status,
    ).toBe('review');
  });
});
