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
import { AuthService } from './auth.service';
import type { User } from './auth.schema';
import {
  MeDto,
  SignInDto,
  type SignInInput,
  SignInResponseDto,
  signInSchema,
} from './dto/auth.dto';
import { type AuthedRequest, Public, SESSION_COOKIE, SessionGuard } from './session.guard';

/**
 * `/v1/auth/*` — versioned, unlike admin, because this is the public contract
 * the web client generates from (DECISIONS I18).
 */
@ApiTags('auth')
@Controller('auth')
@UseGuards(SessionGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('sign-in')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange a provider token for a session',
    description:
      'Sign-up and sign-in are the same call: a verified identity either matches a user or creates one. Sets the httpOnly session cookie; the token is never in the response body.',
  })
  @ApiBody({ type: SignInDto })
  @ApiResponse({ status: 200, type: SignInResponseDto })
  @ApiErrors(400, 401, 403, 429)
  async signIn(
    @Body(new ZodValidationPipe(signInSchema)) body: SignInInput,
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInResponseDto> {
    const { token, expiresAt, user, isNew } = await this.auth.signIn(body.providerToken, {
      ip: request.ip,
      userAgent: request.get('user-agent'),
    });

    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      // `lax`, not `strict` like admin: a user can legitimately arrive from a
      // shared link or a push notification, and `strict` would drop the
      // session on that first navigation and look like being logged out.
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: expiresAt,
    });

    // Built field by field rather than spread: `profile` returns a DTO class
    // instance, and spreading one drops its prototype.
    const profile = await this.profile(user);
    return {
      id: profile.id,
      phone: profile.phone,
      email: profile.email,
      kycVerified: profile.kycVerified,
      wallets: profile.wallets,
      isNew,
    };
  }

  @Post('sign-out')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current session' })
  @ApiErrors(401)
  async signOut(
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (token) await this.auth.signOut(token);
    response.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  @ApiOperation({ summary: 'Who the current session belongs to' })
  @ApiResponse({ status: 200, type: MeDto })
  @ApiErrors(401)
  async me(@Req() request: AuthedRequest): Promise<MeDto> {
    const user = request.user;
    if (!user) throw new UnauthorizedException('Not signed in.');
    return this.profile(user);
  }

  private async profile(user: User): Promise<MeDto> {
    const wallets = await this.auth.walletsFor(user.id);
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      kycVerified: user.kycVerifiedAt !== null,
      wallets: wallets.map((wallet) => ({
        address: wallet.address,
        chainType: wallet.chainType,
        kind: wallet.kind,
      })),
    };
  }
}
