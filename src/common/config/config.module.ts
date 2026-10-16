import { type DynamicModule, Global, Module } from '@nestjs/common';

import { type Env, loadEnv } from './env';

/** DI token for the validated env object. */
export const CONFIG = Symbol('COMPANION_CONFIG');

/** DI token for boot-time warnings, so main.ts can log them once. */
export const CONFIG_WARNINGS = Symbol('COMPANION_CONFIG_WARNINGS');

export interface ConfigModuleOptions {
  /** Override the source of truth. Tests pass a literal object. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Validates the environment at module construction — before any provider is
 * instantiated and long before the HTTP server listens.
 *
 * `@Global` so feature modules do not re-import it. Config is genuinely
 * process-wide, which is the narrow case `Global` exists for; a module that
 * needs a repo or a service still imports it explicitly (CLAUDE.md rule 1).
 */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(options: ConfigModuleOptions = {}): DynamicModule {
    const { env, warnings } = loadEnv(options.env);

    return {
      module: ConfigModule,
      providers: [
        { provide: CONFIG, useValue: Object.freeze(env) satisfies Readonly<Env> },
        { provide: CONFIG_WARNINGS, useValue: Object.freeze(warnings) },
      ],
      exports: [CONFIG, CONFIG_WARNINGS],
    };
  }
}
