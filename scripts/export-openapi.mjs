// Export controller metadata without opening a listener or connecting to services.
// Run `bun run build` first. This is also useful in restricted/offline workspaces.
import 'reflect-metadata';
import process from 'node:process';
import console from 'node:console';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { API_PREFIX_EXCLUSIONS, openApiConfig } from '../dist/common/http/openapi.js';
import { writeFileSync } from 'node:fs';
import { AuthController } from '../dist/modules/auth/auth.controller.js';
import { UsersAdminController } from '../dist/modules/auth/users.admin.controller.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { SessionGuard } from '../dist/modules/auth/session.guard.js';
import { AdminController } from '../dist/modules/admin/admin.controller.js';
import { AdminGuard } from '../dist/modules/admin/admin.guard.js';
import { AdminService } from '../dist/modules/admin/admin.service.js';
import { HealthController, HEALTH_SERVICE } from '../dist/common/http/health.controller.js';

import { KycController } from '../dist/modules/kyc/kyc.controller.js';
import { KycAdminController } from '../dist/modules/kyc/kyc.admin.controller.js';
import { KycService } from '../dist/modules/kyc/kyc.service.js';

// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module metadata container.
class DocumentationModule {}
Module({
  controllers: [
    AuthController,
    UsersAdminController,
    AdminController,
    HealthController,
    KycController,
    KycAdminController,
  ],
  providers: [AuthService, SessionGuard, AdminService, AdminGuard, HEALTH_SERVICE, KycService].map(
    (provide) => ({ provide, useValue: {} }),
  ),
})(DocumentationModule);

async function main() {
  const app = await NestFactory.create(DocumentationModule, { logger: false });
  app.setGlobalPrefix('v1', { exclude: API_PREFIX_EXCLUSIONS });
  const spec = SwaggerModule.createDocument(app, openApiConfig());
  writeFileSync(
    process.argv[2] ?? '/private/tmp/rendezvous-openapi.json',
    JSON.stringify(spec, null, 2),
  );
  await app.close();
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
