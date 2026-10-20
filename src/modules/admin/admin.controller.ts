import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { ApiErrors } from '../../common/http/api-error.dto';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { ADMIN_SESSION_COOKIE, AdminGuard, AdminPublic, type AdminRequest } from './admin.guard';
import { AdminService, type RequestContext } from './admin.service';
import {
  AdminProfileDto,
  LoginDto,
  type LoginInput,
  LoginResponseDto,
  loginSchema,
  TotpDto,
  type TotpInput,
  totpSchema,
} from './dto/admin.dto';

/**
 * `/admin/auth/*` — the only admin routes that exist yet.
 *
 * A deviation from the CLAUDE.md layout worth naming: other modules split user
 * routes (`<module>.controller.ts`) from admin routes
 * (`<module>.admin.controller.ts`). The admin module has no user routes at all,
 * so there is nothing to split and this one controller is the whole surface.
 *
 * The guard is on the **class**, and login opts out with `@AdminPublic()`.
 * Deny by default, so a route added later is protected unless someone
 * deliberately says otherwise.
 */
@ApiTags('admin')
@Controller('admin/auth')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admins: AdminService) {}

  @Post('login')
  @AdminPublic()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Step one of two: email and password',
    description:
      'Never issues a session. Returns a short-lived challenge to exchange for one at /admin/auth/totp.',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiErrors(400, 401)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: AdminRequest,
  ): Promise<LoginResponseDto> {
    const outcome = await this.admins.login(body.email, body.password, context(request));

    // `kind: 'session'` is unreachable from this endpoint by design — the type
    // allows it so the service can grow a path that skips TOTP (it should not).
    if (outcome.kind === 'session') throw new Error('login must not issue a session');

    return {
      kind: outcome.kind,
      challenge: outcome.challenge,
      ...(outcome.kind === 'totp_enrolment' ? { uri: outcome.uri } : {}),
    };
  }

  @Post('totp')
  @AdminPublic()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Step two of two: the authenticator code',
    description: 'Sets the httpOnly session cookie. The token is never in the response body.',
  })
  @ApiBody({ type: TotpDto })
  @ApiResponse({ status: 200, type: AdminProfileDto })
  @ApiErrors(400, 401)
  async totp(
    @Body(new ZodValidationPipe(totpSchema)) body: TotpInput,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminProfileDto> {
    const { token, expiresAt, adminUser } = await this.admins.verifyTotpAndIssueSession(
      body.challenge,
      body.code,
      context(request),
    );

    response.cookie(ADMIN_SESSION_COOKIE, token, {
      // Not readable by JavaScript, so an XSS cannot lift the session.
      httpOnly: true,
      // `strict`, not `lax`: nothing should ever navigate into the admin
      // console from another site, so there is no flow this breaks.
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/admin',
      expires: expiresAt,
    });

    return profile(adminUser);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current session' })
  @ApiErrors(401)
  async logout(
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = (request.cookies as Record<string, string> | undefined)?.[ADMIN_SESSION_COOKIE];
    if (token) await this.admins.logout(token, context(request));
    response.clearCookie(ADMIN_SESSION_COOKIE, { path: '/admin' });
  }

  @Get('me')
  @ApiOperation({ summary: 'Who the current session belongs to' })
  @ApiResponse({ status: 200, type: AdminProfileDto })
  @ApiErrors(401)
  me(@Req() request: AdminRequest): AdminProfileDto {
    const admin = request.admin;
    // The guard throws before reaching here, so this is unreachable — but an
    // assertion would hide it if the guard were ever removed from the class.
    if (!admin) throw new UnauthorizedException('Not signed in.');
    return profile(admin);
  }
}

function context(request: AdminRequest): RequestContext {
  return {
    ip: request.ip,
    userAgent: request.get('user-agent'),
  };
}

function profile(admin: {
  id: string;
  email: string;
  role: 'admin' | 'moderator';
  lastLoginAt: Date | null;
}): AdminProfileDto {
  return {
    id: admin.id,
    email: admin.email,
    role: admin.role,
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
  };
}
