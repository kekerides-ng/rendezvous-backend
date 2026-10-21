import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-error.dto';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { type AuthedRequest, SessionGuard } from '../auth';
import {
  AssetDto,
  AssetListDto,
  RemovedDto,
  assetIdSchema,
  UploadRequestDto,
  UploadReservationDto,
  uploadSchema,
} from './dto/media.dto';
import { MediaService } from './media.service';

@ApiTags('media')
@Controller('media')
@UseGuards(SessionGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  private userId(request: AuthedRequest) {
    if (!request.user) throw new UnauthorizedException('Not signed in.');
    return request.user.id;
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List your uploaded photos and their availability' })
  @ApiResponse({ status: 200, type: AssetListDto })
  @ApiErrors(401)
  mine(@Req() request: AuthedRequest) {
    return this.media.mine(this.userId(request));
  }

  @Post('uploads')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Reserve a private photo and get a five-minute upload URL' })
  @ApiBody({ type: UploadRequestDto })
  @ApiResponse({ status: 200, type: UploadReservationDto })
  @ApiErrors(400, 401, 409, 429, 503)
  reserve(
    @Body(new ZodValidationPipe(uploadSchema)) body: UploadRequestDto,
    @Req() request: AuthedRequest,
  ) {
    return this.media.reserve(this.userId(request), body.contentType, body.bytes);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Confirm uploaded object metadata and submit it for moderation' })
  @ApiResponse({ status: 200, type: AssetDto })
  @ApiErrors(400, 401, 404, 409, 503)
  complete(
    @Param('id', new ZodValidationPipe(assetIdSchema)) id: string,
    @Req() request: AuthedRequest,
  ) {
    return this.media.complete(this.userId(request), id);
  }

  @Delete(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Remove one of your photos' })
  @ApiResponse({ status: 200, type: RemovedDto })
  @ApiErrors(400, 401, 404, 503)
  remove(
    @Param('id', new ZodValidationPipe(assetIdSchema)) id: string,
    @Req() request: AuthedRequest,
  ) {
    return this.media.remove(this.userId(request), id);
  }
}
