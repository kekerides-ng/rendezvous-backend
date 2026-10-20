import { Module } from '@nestjs/common';

import { CONFIG } from '../../common/config';
import { type Env, requirePrivy } from '../../common/config/env';
import { AdminModule } from '../admin';
import { UsersAdminController } from './users.admin.controller';
import { AuthController } from './auth.controller';
import { AuthRepo } from './auth.repo';
import { AuthService } from './auth.service';
import { IDENTITY_PROVIDER } from './domain/identity-provider';
import { PrivyIdentityProvider } from './privy.provider';
import { SessionGuard } from './session.guard';

/**
 * `IDENTITY_PROVIDER` is bound to Privy **here and nowhere else**. Everything
 * downstream depends on the interface, so swapping provider — or dropping to
 * our own OTP if Privy's per-MAU pricing stops making sense — is this one
 * factory (`domain/identity-provider.ts` explains why that matters).
 *
 * `requirePrivy` throws at construction if the credentials are missing, which
 * is the module enforcing its own requirement rather than `loadEnv` doing it
 * for everyone (DECISIONS I12).
 */
@Module({
  imports: [AdminModule],
  controllers: [AuthController, UsersAdminController],
  providers: [
    AuthRepo,
    AuthService,
    SessionGuard,
    {
      provide: IDENTITY_PROVIDER,
      inject: [CONFIG],
      useFactory: (config: Readonly<Env>) => {
        const { appId, appSecret } = requirePrivy(config);
        return new PrivyIdentityProvider(appId, appSecret);
      },
    },
  ],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
