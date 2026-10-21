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
import { z } from 'zod';
import { ApiErrors } from '../../common/http/api-error.dto';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { AdminGuard } from '../admin';
import type { AdminRequest } from '../admin/admin.guard';
import { ReasonDto, reasonSchema, userIdSchema } from '../auth/dto/users.dto';
import { KycReviewItemDto, KycReviewPageDto, kycQueueSchema } from './dto/kyc.dto';
import { KycService } from './kyc.service';

@ApiTags('admin-kyc')
@Controller('admin/kyc')
@UseGuards(AdminGuard)
export class KycAdminController {
  constructor(private readonly kyc: KycService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List identity checks awaiting review, without identity documents' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, type: KycReviewPageDto })
  @ApiErrors(400, 401)
  queue(@Query(new ZodValidationPipe(kycQueueSchema)) query: z.infer<typeof kycQueueSchema>) {
    return this.kyc.queue(query.page, query.pageSize);
  }
  @Post(':id/reject')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Reject a pending review with an audited reason' })
  @ApiBody({ type: ReasonDto })
  @ApiResponse({ status: 200, type: KycReviewItemDto })
  @ApiErrors(400, 401, 403, 404, 409)
  reject(
    @Param('id', new ZodValidationPipe(userIdSchema)) id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: ReasonDto,
    @Req() request: AdminRequest,
  ) {
    return this.kyc.reject(id, body.reason, request);
  }
}
