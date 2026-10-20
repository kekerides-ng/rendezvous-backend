import { Module } from '@nestjs/common';

import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminRepo } from './admin.repo';
import { AdminService } from './admin.service';

/**
 * Built first, because `AdminGuard` and the audit log are infrastructure every
 * later module writes to (build-plan 1.1).
 *
 * `AdminService` and `AdminGuard` are exported; `AdminRepo` deliberately is
 * not — another module reaching the repo would be touching `admin.*` tables
 * directly, which rule 1 forbids.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminRepo, AdminService, AdminGuard],
  exports: [AdminService, AdminGuard],
})
export class AdminModule {}
