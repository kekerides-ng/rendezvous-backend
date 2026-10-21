import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-error.dto';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { AdminGuard } from '../admin';
import type { AdminRequest } from '../admin/admin.guard';
import {
  AssetDto,
  assetIdSchema,
  MediaQueueDto,
  mediaQueueSchema,
  ReviewDto,
  reviewSchema,
} from './dto/media.dto';
import { MediaService } from './media.service';

@ApiTags('admin-media')
@Controller('admin/media')
@UseGuards(AdminGuard)
export class MediaAdminController {
  constructor(private readonly media: MediaService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List photos awaiting moderation' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, type: MediaQueueDto })
  @ApiErrors(400, 401)
  queue(@Query(new ZodValidationPipe(mediaQueueSchema)) query: { page: number; pageSize: number }) {
    return this.media.queue(query.page, query.pageSize);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Approve a photo with an audited reason' })
  @ApiBody({ type: ReviewDto })
  @ApiResponse({ status: 200, type: AssetDto })
  @ApiErrors(400, 401, 404, 409)
  approve(
    @Param('id', new ZodValidationPipe(assetIdSchema)) id: string,
    @Body(new ZodValidationPipe(reviewSchema)) body: ReviewDto,
    @Req() request: AdminRequest,
  ) {
    return this.media.review(id, 'approve', body.reason, request);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Reject a photo with an audited reason' })
  @ApiBody({ type: ReviewDto })
  @ApiResponse({ status: 200, type: AssetDto })
  @ApiErrors(400, 401, 404, 409)
  reject(
    @Param('id', new ZodValidationPipe(assetIdSchema)) id: string,
    @Body(new ZodValidationPipe(reviewSchema)) body: ReviewDto,
    @Req() request: AdminRequest,
  ) {
    return this.media.review(id, 'reject', body.reason, request);
  }
}
