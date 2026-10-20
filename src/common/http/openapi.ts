import { DocumentBuilder } from '@nestjs/swagger';

/** Keep live Swagger and offline client generation on the same API contract. */
export const API_PREFIX_EXCLUSIONS = ['health', 'health/live', 'admin/(.*)'];

export function openApiConfig() {
  return new DocumentBuilder()
    .setTitle('companion-backend')
    .setDescription(
      'Time-and-company booking platform. Money is integer micro-USDC held in an on-chain escrow on Base.',
    )
    .setVersion('0.0.1')
    .addCookieAuth('session')
    .addTag('health')
    .build();
}
