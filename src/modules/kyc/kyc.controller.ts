import { Controller, Get, Header, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-error.dto';
import { type AuthedRequest, SessionGuard } from '../auth/session.guard';
import { KycStatusDto } from './dto/kyc.dto';
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
}
