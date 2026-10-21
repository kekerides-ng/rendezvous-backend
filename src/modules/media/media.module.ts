import { Module } from '@nestjs/common';
import { AdminModule } from '../admin';
import { AuthModule } from '../auth';
import { MediaAdminController } from './media.admin.controller';
import { MediaController } from './media.controller';
import { MediaRepo } from './media.repo';
import { MediaService } from './media.service';
import { MediaStorage } from './storage';

@Module({
  imports: [AdminModule, AuthModule],
  controllers: [MediaController, MediaAdminController],
  providers: [MediaRepo, MediaStorage, MediaService],
  exports: [MediaService],
})
export class MediaModule {}
