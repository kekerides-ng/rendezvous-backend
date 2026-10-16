import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import {
  CORRELATION_HEADER,
  getCorrelationId,
  normaliseCorrelationId,
} from '../correlation/correlation';
import { REDACT_CENSOR, REDACT_PATHS } from './redact';

export interface AppLoggerOptions {
  readonly level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  /** Pretty-print instead of JSON lines. Development only. */
  readonly pretty: boolean;
  /** Health checks are noise at one request per second. */
  readonly ignorePaths?: readonly string[];
}

/**
 * pino, wired for this app: JSON lines in deploy, a request id on every record,
 * and the redaction rules from `redact.ts` applied centrally.
 */
@Module({})
export class AppLoggerModule {
  static forRoot(options: AppLoggerOptions): DynamicModule {
    const ignore = new Set(options.ignorePaths ?? ['/health', '/health/live']);

    return {
      module: AppLoggerModule,
      imports: [
        PinoLoggerModule.forRoot({
          pinoHttp: {
            level: options.level,

            // ISO timestamps rather than epoch millis: logs get read by people
            // across three environments, and every aggregator parses both.
            timestamp: () => `,"time":"${new Date().toISOString()}"`,

            formatters: {
              // "level":"info" instead of "level":30.
              level: (label) => ({ level: label }),
            },

            redact: {
              paths: [...REDACT_PATHS],
              censor: REDACT_CENSOR,
              remove: false,
            },

            // Reuse the id the middleware already normalised, so the log's reqId
            // and the `x-request-id` the client sees are the same string.
            genReqId: (req, res) => {
              const existing = getCorrelationId();
              const id = existing ?? normaliseCorrelationId(req.headers[CORRELATION_HEADER]);
              res.setHeader(CORRELATION_HEADER, id);
              return id;
            },

            // A flat field, so a query is `correlationId:abc` and not `req.id:abc`.
            customProps: () => ({ correlationId: getCorrelationId() }),

            autoLogging: {
              ignore: (req) => ignore.has(req.url?.split('?')[0] ?? ''),
            },

            // Only what is useful and safe. pino-http's default request
            // serialiser logs every header, which includes authorization and
            // cookies — redaction catches those two, but not the next one
            // somebody adds.
            serializers: {
              req: (req: { method?: string; url?: string }) => ({
                method: req.method,
                url: req.url?.split('?')[0],
              }),
              res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
            },

            ...(options.pretty
              ? {
                  transport: {
                    target: 'pino-pretty',
                    options: { singleLine: true, translateTime: 'HH:MM:ss.l' },
                  },
                }
              : {}),
          },
        }),
      ],
      exports: [PinoLoggerModule],
    };
  }
}
