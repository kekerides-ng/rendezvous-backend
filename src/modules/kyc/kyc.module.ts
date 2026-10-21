import { Module } from '@nestjs/common';
import { AdminModule } from '../admin';
import { AuthModule } from '../auth';
import { KycAdminController } from './kyc.admin.controller';
import { KycController } from './kyc.controller';
import { KycRepo } from './kyc.repo';
import { KycService } from './kyc.service';

@Module({
  imports: [AdminModule, AuthModule],
  controllers: [KycController, KycAdminController],
  providers: [KycRepo, KycService],
  exports: [KycService],
})
export class KycModule {}
