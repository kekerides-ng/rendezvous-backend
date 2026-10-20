import 'dotenv/config';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { AdminRepo } from '../src/modules/admin/admin.repo';
import { AdminService } from '../src/modules/admin/admin.service';
import { databaseError } from './database-error';
import { checkPassword } from '../src/modules/admin/domain/credentials';

/**
 * Creates the first admin.
 *
 *   bun run admin:create ada@rendezvous.ng 'correct horse battery staple' admin
 *
 * This exists because of a real bootstrapping hole: admin creation is behind
 * `AdminGuard`, and there is nobody to authenticate as until an admin exists.
 * A seed route guarded by "only works when the table is empty" is the usual
 * answer and a bad one — it is an unauthenticated account-creation endpoint
 * living in production forever, one truncated table away from being usable.
 *
 * A CLI needs shell access to the server, which is a much better fence.
 *
 * It goes through `AdminService`, not straight to SQL, so the password rules
 * and the audit row apply exactly as they would anywhere else. An admin
 * created here is indistinguishable from one created through the console later.
 */
async function main(): Promise<void> {
  const [email, password, role = 'admin'] = process.argv.slice(2);

  if (!email || !password) {
    console.error('Usage: bun run admin:create <email> <password> [admin|moderator]');
    console.error('Quote the password if it contains spaces — and it should.');
    process.exit(1);
  }

  if (role !== 'admin' && role !== 'moderator') {
    console.error(`Role must be "admin" or "moderator", not "${role}".`);
    process.exit(1);
  }

  const problems = checkPassword(password);
  if (problems.length > 0) {
    console.error(`That password ${problems.join(', ')}.`);
    process.exit(1);
  }

  // No HTTP server: this needs the DI container and nothing else.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const repo = app.get(AdminRepo);
    const existing = await repo.findByEmail(email);
    if (existing) {
      console.error(`${email} already exists. Nothing changed.`);
      process.exitCode = 1;
      return;
    }

    const created = await app.get(AdminService).createAdmin({
      email,
      password,
      role,
      context: { ip: 'cli', userAgent: 'admin:create' },
    });

    console.log(`Created ${created.email} as ${created.role}.`);
    console.log('');
    console.log('Next: sign in twice.');
    console.log('  1. POST /admin/auth/login with the email and password.');
    console.log('     It returns an otpauth:// URI — scan it with an authenticator app.');
    console.log('  2. POST /admin/auth/totp with that challenge and the 6-digit code.');
    console.log('     That sets the session cookie. 2FA is now required on every sign-in.');
  } finally {
    await app.close();
  }
}

// Not top-level await: the project compiles to CommonJS. Catching here also
// means a failure exits non-zero with a readable message rather than an
// unhandled rejection trace, which matters for a command run in a deploy shell.
main().catch((error: unknown) => {
  console.error(`Admin creation failed: ${databaseError(error)}`);
  process.exit(1);
});
