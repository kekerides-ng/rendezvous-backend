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
import { AdminGuard, AdminRoles } from '../admin';
import type { AdminRequest } from '../admin/admin.guard';
import { AuthService } from './auth.service';
import {
  ReasonDto,
  reasonSchema,
  RevealedPhoneDto,
  UserItemDto,
  userIdSchema,
  UsersPageDto,
  usersQuerySchema,
  type UsersQuery,
} from './dto/users.dto';

@ApiTags('admin-users')
@Controller('admin/users')
@UseGuards(AdminGuard)
export class UsersAdminController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List users with masked contact information' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1, maximum: 1000000 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'status', required: false, enum: ['all', 'active', 'suspended'] })
  @ApiQuery({ name: 'sort', required: false, enum: ['createdAt', 'lastLoginAt'] })
  @ApiQuery({ name: 'direction', required: false, enum: ['asc', 'desc'] })
  @ApiResponse({ status: 200, type: UsersPageDto })
  @ApiErrors(400, 401)
  list(@Query(new ZodValidationPipe(usersQuerySchema)) query: UsersQuery) {
    return this.auth.listUsers(query);
  }

  @Post(':id/reveal-phone')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Reveal a phone number after recording access in the audit log' })
  @ApiResponse({ status: 200, type: RevealedPhoneDto })
  @ApiErrors(400, 401, 404)
  reveal(
    @Param('id', new ZodValidationPipe(userIdSchema)) id: string,
    @Req() request: AdminRequest,
  ) {
    return this.auth.revealPhone(id, request);
  }

  @Post(':id/suspend')
  @AdminRoles('admin')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Suspend a user and revoke every session' })
  @ApiBody({ type: ReasonDto })
  @ApiResponse({ status: 200, type: UserItemDto })
  @ApiErrors(400, 401, 403, 404, 409)
  suspend(
    @Param('id', new ZodValidationPipe(userIdSchema)) id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: ReasonDto,
    @Req() request: AdminRequest,
  ) {
    return this.auth.changeSuspension(id, true, body.reason, request);
  }

  @Post(':id/reinstate')
  @AdminRoles('admin')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Reinstate a user; a fresh sign-in is required' })
  @ApiBody({ type: ReasonDto })
  @ApiResponse({ status: 200, type: UserItemDto })
  @ApiErrors(400, 401, 403, 404, 409)
  reinstate(
    @Param('id', new ZodValidationPipe(userIdSchema)) id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: ReasonDto,
    @Req() request: AdminRequest,
  ) {
    return this.auth.changeSuspension(id, false, body.reason, request);
  }
}
