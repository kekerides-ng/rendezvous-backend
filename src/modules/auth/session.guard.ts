import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AuthService } from './auth.service';
import type { User } from './auth.schema';

/** Distinct from the admin cookie, so one can never satisfy the other. */
export const SESSION_COOKIE = 'rdv_session';

const PUBLIC_KEY = 'auth:public';

/** Opt a route out of the guard. Sign-in needs this; almost nothing else does. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export interface AuthedRequest extends Request {
  user?: User;
}

/**
 * Guards user routes. **Deny by default**, like `AdminGuard` — a route added
 * in a hurry is protected unless someone deliberately says otherwise.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException('Not signed in.');

    const user = await this.auth.resolveSession(token);
    if (!user) throw new UnauthorizedException('Your session has expired.');

    request.user = user;
    return true;
  }
}
