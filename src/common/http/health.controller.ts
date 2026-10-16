import { Controller, Get, Inject, Res } from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { HealthService, type ReadinessReport } from './health';

export const HEALTH_SERVICE = Symbol('COMPANION_HEALTH_SERVICE');

interface HttpResponse {
  status: (code: number) => HttpResponse;
  json: (body: unknown) => void;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_SERVICE) private readonly health: HealthService) {}

  /**
   * Readiness: 200 when ready, 503 when a critical dependency is down or the
   * process is draining. 503 removes the instance from the load balancer
   * without restarting it.
   */
  @Get()
  @ApiOkResponse({ description: 'Every critical dependency is reachable.' })
  @ApiServiceUnavailableResponse({ description: 'A critical dependency is down, or draining.' })
  async ready(@Res() response: HttpResponse): Promise<void> {
    const report: ReadinessReport = await this.health.ready();
    response.status(report.status === 'ready' ? 200 : 503).json(report);
  }

  /**
   * Liveness: always 200 while the event loop turns. Checks NO dependencies —
   * a failure here restarts the process, and a database blip must never do that.
   */
  @Get('live')
  @ApiExcludeEndpoint()
  live(): { status: 'ok' } {
    return this.health.live();
  }
}
