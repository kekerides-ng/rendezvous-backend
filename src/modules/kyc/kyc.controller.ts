import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors } from '../../common/http/api-error.dto';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { type AuthedRequest, SessionGuard } from '../auth/session.guard';
import { KycStatusDto, VerifyNinDto, verifyNinSchema } from './dto/kyc.dto';
import { KycService } from './kyc.service';

@ApiTags('kyc')
@Controller('kyc')
@UseGuards(SessionGuard)
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get the signed-in user’s verification status' })
  @ApiResponse({ status: 200, type: KycStatusDto })
  @ApiErrors(401)
  status(@Req() request: AuthedRequest) {
    if (!request.user) throw new UnauthorizedException('Not signed in.');
    return this.kyc.status(request.user.id);
  }

  @Post('verify')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Check a Nigerian NIN, legal details, selfie, and adult age' })
  @ApiBody({ type: VerifyNinDto })
  @ApiResponse({ status: 200, type: KycStatusDto })
  @ApiErrors(400, 401, 409, 429, 503)
  verify(
    @Body(new ZodValidationPipe(verifyNinSchema)) body: z.infer<typeof verifyNinSchema>,
    @Req() request: AuthedRequest,
  ) {
    if (!request.user) throw new UnauthorizedException('Not signed in.');
    return this.kyc.verifyNin(request.user.id, body);
  }
}
