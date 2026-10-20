/**
 * The seam between us and whoever verifies a person's identity.
 *
 * `architecture.md` §4: the backend verifies the provider's token **once** and
 * then issues its own session cookie. Privy vouches that a phone number is
 * real; it never owns our session.
 *
 * That is deliberate and load-bearing. Privy bills per monthly active user,
 * and the economics of letting them do sign-in versus doing our own OTP flip
 * depending on how many people browse without ever booking — a ratio nobody
 * will know for a year. Keeping the provider behind this interface means
 * changing that answer later is replacing one implementation, not rewriting
 * sessions, screens, rate limits and audit rows.
 */
export interface VerifiedIdentity {
  /** The provider's id for this person. Stable across logins. */
  readonly providerUserId: string;
  readonly phone?: string | undefined;
  readonly email?: string | undefined;
  readonly wallets: readonly {
    readonly address: string;
    /** `ethereum` or `solana` — the family, not a chain id. See auth.schema. */
    readonly chainType: string;
    readonly kind: 'embedded' | 'external';
  }[];
}

export interface IdentityProvider {
  /** Throws if the token is invalid, expired, or not ours. */
  verify(token: string): Promise<VerifiedIdentity>;
}

/** DI token, so the module depends on the interface and not on Privy. */
export const IDENTITY_PROVIDER = Symbol('COMPANION_IDENTITY_PROVIDER');
