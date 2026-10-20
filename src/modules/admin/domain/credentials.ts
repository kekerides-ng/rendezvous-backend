import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { hash, verify } from '@node-rs/argon2';
import { Secret, TOTP } from 'otpauth';

/**
 * Pure credential logic: no Nest, no database (CLAUDE.md layout — `domain/`).
 *
 * Kept separate so the security-critical parts can be tested directly, without
 * standing up a module. Everything here is about making one of three things
 * hard: guessing a password, replaying a session token, or reusing a TOTP code.
 */

/**
 * argon2**id**, not argon2i or argon2d.
 *
 * id is the hybrid the RFC recommends: the d side resists GPU cracking, the i
 * side resists side-channel attacks. The parameters are OWASP's current
 * minimum — 19 MiB and two passes — chosen for *memory* over iterations,
 * because memory is what a GPU farm cannot cheaply parallelise.
 */
const ARGON2 = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2);
}

export function verifyPassword(plain: string, stored: string): Promise<boolean> {
  // argon2 verify is already constant-time with respect to the hash.
  return verify(stored, plain, ARGON2).catch(() => false);
}

/**
 * Password rules, as a list of what failed rather than a boolean.
 *
 * Length over composition: a 12-character passphrase beats
 * "Password1!" by every measure, and composition rules mostly teach people to
 * put the `!` at the end. This is an admin console, so there is a floor —
 * but the floor is length.
 */
export const MIN_PASSWORD_LENGTH = 12;

export function checkPassword(plain: string): string[] {
  const problems: string[] = [];
  if (plain.length < MIN_PASSWORD_LENGTH) {
    problems.push(`must be at least ${String(MIN_PASSWORD_LENGTH)} characters`);
  }
  if (/^\s|\s$/.test(plain)) problems.push('must not start or end with a space');
  return problems;
}

/** How long a session lasts without re-authenticating. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface IssuedToken {
  /** Goes in the cookie. Shown once, never stored. */
  readonly token: string;
  /** Goes in the database. */
  readonly hash: string;
}

/**
 * A session token: 32 random bytes, stored only as a SHA-256.
 *
 * Plain SHA-256 rather than argon2 here, deliberately. Argon2 is slow **on
 * purpose** to make guessing a low-entropy secret expensive; a 256-bit random
 * token has nothing to guess, and the cost would be paid on every single
 * authenticated request. The property that matters is that the stored value
 * cannot be presented as a session, which a hash gives either way.
 */
export function issueToken(): IssuedToken {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Compare two token hashes without leaking where they diverge.
 *
 * The lookup is by indexed hash, so this is belt-and-braces — but a timing
 * side channel on a session token is a real class of bug and the fix is three
 * lines.
 */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const TOTP_ISSUER = 'Rendezvous Admin';

export function createTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/** The `otpauth://` URI an authenticator app scans. */
export function totpUri(email: string, secret: string): string {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label: email,
    secret: Secret.fromBase32(secret),
    digits: 6,
    period: 30,
  }).toString();
}

/**
 * Verify a 6-digit code.
 *
 * `window: 1` accepts the previous and next 30-second step — about 90 seconds
 * of tolerance. That is not laxity: phone clocks drift, and someone typing a
 * code as it rolls over should not be told their authenticator is wrong. A
 * window of 0 produces support tickets; a large window produces a replay
 * surface.
 *
 * Returns the matched step, so the caller can refuse a code that has already
 * been used — `otpauth` returns a delta, and `null` for no match.
 */
export function verifyTotp(secret: string, code: string): number | null {
  const totp = new TOTP({
    issuer: TOTP_ISSUER,
    secret: Secret.fromBase32(secret),
    digits: 6,
    period: 30,
  });

  const delta = totp.validate({ token: code.replace(/\s/g, ''), window: 1 });
  if (delta === null) return null;

  // An absolute step number, so "already used" survives across requests.
  return Math.floor(Date.now() / 30_000) + delta;
}
