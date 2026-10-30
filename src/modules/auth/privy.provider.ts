import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrivyClient } from '@privy-io/server-auth';

import type { IdentityProvider, VerifiedIdentity } from './domain/identity-provider';

/**
 * Privy, behind the `IdentityProvider` seam.
 *
 * Two things it does for us, and only two: it proves an email address (typed,
 * or vouched for by Google) belongs to whoever is holding the token, and it gives that person an
 * embedded Base wallet (architecture.md §4, §5).
 *
 * Everything after that is ours — our user row, our session cookie, our rate
 * limits. If this file is ever deleted, nothing above it changes shape.
 */
@Injectable()
export class PrivyIdentityProvider implements IdentityProvider {
  private readonly logger = new Logger(PrivyIdentityProvider.name);
  private readonly client: PrivyClient;

  constructor(appId: string, appSecret: string) {
    this.client = new PrivyClient(appId, appSecret);
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    let claims: Awaited<ReturnType<PrivyClient['verifyAuthToken']>>;
    try {
      // Verifies the signature and that the token was issued for OUR app —
      // a valid Privy token from a different app must not log anyone in here.
      claims = await this.client.verifyAuthToken(token);
    } catch {
      // Deliberately not logging the token or the reason: a rejected token is
      // routine, and the detail is only useful to someone probing.
      throw new UnauthorizedException('That sign-in could not be verified.');
    }

    const user = await this.client.getUserById(claims.userId);

    const wallets = user.linkedAccounts
      .filter((account) => account.type === 'wallet')
      .map((account) => ({
        address: account.address.toLowerCase(),
        // `chainType`, not the deprecated `chainId`: Privy reports the family
        // (`ethereum`/`solana`), which is the only part that is a property of
        // the wallet rather than of the transaction.
        chainType: account.chainType,
        // `walletClientType === 'privy'` is the embedded one Privy custodies;
        // anything else is a wallet the user brought.
        kind: account.walletClientType === 'privy' ? ('embedded' as const) : ('external' as const),
      }));

    return {
      providerUserId: claims.userId,
      phone: user.phone?.number,
      // A Google sign-in has no `user.email` — Privy files the address under
      // the Google account instead. Without this fallback every Google user
      // would be stored with no email at all.
      email: user.email?.address ?? user.google?.email,
      wallets,
    };
  }
}
