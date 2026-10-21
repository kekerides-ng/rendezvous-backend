import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { MediaController } from './media.controller';
import { MediaRepo } from './media.repo';
import { MediaService } from './media.service';
import { MediaStorage } from './storage';

@Module({
  imports: [AuthModule],
  controllers: [MediaController],
  providers: [MediaRepo, MediaStorage, MediaService],
  exports: [MediaService],
})
export class MediaModule {}
