import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ForbiddenException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AdminService } from './admin.service';
import type { AdminRole, AdminUser } from './admin.schema';

/** The cookie name. Prefixed so it cannot collide with the user session. */
export const ADMIN_SESSION_COOKIE = 'rdv_admin_session';

const ROLES_KEY = 'admin:roles';
const PUBLIC_KEY = 'admin:public';

/** Opt a route out of the guard — login and the TOTP step need this. */
export const AdminPublic = () => SetMetadata(PUBLIC_KEY, true);

/** Narrow a route to specific roles. Absent means any signed-in admin. */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

/** The authenticated admin, attached by the guard. */
export interface AdminRequest extends Request {
  admin?: AdminUser;
}

/**
 * Guards every `/admin/*` route (architecture.md §4).
 *
 * **Deny by default.** The guard is applied to the whole controller and routes
 * opt *out* with `@AdminPublic()`. The opposite — opting in with a decorator —
 * means a new endpoint added in a hurry is unprotected, and nothing fails to
 * tell you.
 *
 * It reads the session from an httpOnly cookie rather than a header. A header
 * has to be attached by JavaScript, which means the token lives somewhere
 * JavaScript can read it, which means an XSS gets it (CLAUDE.md rule 2 says the
 * same for the user app).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly admins: AdminService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AdminRequest>();
    const token = (request.cookies as Record<string, string> | undefined)?.[ADMIN_SESSION_COOKIE];
    if (!token) throw new UnauthorizedException('Not signed in.');

    const admin = await this.admins.resolveSession(token);
    if (!admin) throw new UnauthorizedException('Your session has expired.');

    const required = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // `admin` implies every moderator permission; a moderator is not an admin.
    if (required !== undefined && required.length > 0) {
      const permitted = admin.role === 'admin' || required.includes(admin.role);
      if (!permitted) throw new ForbiddenException('Not allowed.');
    }

    request.admin = admin;
    return true;
  }
}
