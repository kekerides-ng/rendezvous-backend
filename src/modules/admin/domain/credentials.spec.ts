import { Secret, TOTP } from 'otpauth';
import { describe, expect, it, vi } from 'vitest';

import {
  checkPassword,
  createTotpSecret,
  hashPassword,
  hashToken,
  issueToken,
  MIN_PASSWORD_LENGTH,
  tokensMatch,
  totpUri,
  verifyPassword,
  verifyTotp,
} from './credentials';

describe('passwords', () => {
  it('verifies a correct password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false);
  });

  it('returns false rather than throwing on a corrupt hash', async () => {
    // A malformed row must fail the login, not 500 the endpoint — which would
    // tell an attacker they had found a real account with broken data.
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });

  it('produces a different hash each time', async () => {
    // Salted. Two admins with the same password must not be visibly equal.
    const [a, b] = await Promise.all([
      hashPassword('same password here'),
      hashPassword('same password here'),
    ]);
    expect(a).not.toBe(b);
  });

  it('is argon2id', async () => {
    expect(await hashPassword('a password long enough')).toMatch(/^\$argon2id\$/);
  });

  it('requires length over composition', () => {
    expect(checkPassword('Sh0rt!')).toContain(
      `must be at least ${String(MIN_PASSWORD_LENGTH)} characters`,
    );
    // A passphrase with no symbols is fine; this is the point.
    expect(checkPassword('correct horse battery staple')).toEqual([]);
  });

  it('refuses leading or trailing whitespace', () => {
    // Almost always a paste accident, and invisible to the person who did it.
    expect(checkPassword(' a password long enough ')).toContain(
      'must not start or end with a space',
    );
  });
});

describe('session tokens', () => {
  it('never stores the token itself', () => {
    const { token, hash } = issueToken();
    expect(hash).not.toContain(token);
    expect(hash).toBe(hashToken(token));
  });

  it('is unguessable', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => issueToken().token));
    expect(tokens.size).toBe(200);
    // 32 bytes, base64url.
    expect([...tokens][0]).toHaveLength(43);
  });

  it('compares hashes safely', () => {
    const { token, hash } = issueToken();
    expect(tokensMatch(hashToken(token), hash)).toBe(true);
    expect(tokensMatch(hashToken('other'), hash)).toBe(false);
  });

  it('does not throw on different lengths', () => {
    // timingSafeEqual throws on a length mismatch; that must not reach a handler.
    expect(() => tokensMatch('short', 'much longer value')).not.toThrow();
    expect(tokensMatch('short', 'much longer value')).toBe(false);
  });
});

describe('TOTP', () => {
  it('builds a scannable URI naming the issuer', () => {
    const secret = createTotpSecret();
    const uri = totpUri('ada@rendezvous.ng', secret);
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('Rendezvous%20Admin');
    expect(uri).toContain(secret);
  });

  it('rejects a wrong code', () => {
    expect(verifyTotp(createTotpSecret(), '000000')).toBeNull();
  });

  it('accepts a code from the previous step, for clock drift', () => {
    vi.useFakeTimers();
    try {
      const secret = createTotpSecret();
      vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));

      // Produce a code, then advance 30s — someone typing as it rolls over.
      const code = new TOTP({
        secret: Secret.fromBase32(secret),
        digits: 6,
        period: 30,
      }).generate();

      vi.setSystemTime(new Date('2026-10-20T12:00:31Z'));
      expect(verifyTotp(secret, code)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns a step number, so a used code can be refused', () => {
    vi.useFakeTimers();
    try {
      const secret = createTotpSecret();
      vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
      const code = new TOTP({
        secret: Secret.fromBase32(secret),
        digits: 6,
        period: 30,
      }).generate();

      const step = verifyTotp(secret, code);
      expect(typeof step).toBe('number');
      // Same code, same step — which is what lets the service store it as spent.
      expect(verifyTotp(secret, code)).toBe(step);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores spaces people paste in', () => {
    vi.useFakeTimers();
    try {
      const secret = createTotpSecret();
      vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
      const code = new TOTP({
        secret: Secret.fromBase32(secret),
        digits: 6,
        period: 30,
      }).generate();
      expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
