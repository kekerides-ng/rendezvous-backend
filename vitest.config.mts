import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * `.mts`, because package.json has no `"type": "module"` — Nest compiles to
 * CommonJS — and Vite's native config loader would otherwise read this ESM file
 * as CJS.
 *
 * The swc plugin is not optional. Vitest transforms TypeScript with esbuild,
 * and esbuild does NOT emit `emitDecoratorMetadata` — so the moment a test
 * builds a Nest module, every constructor parameter type is `undefined` and DI
 * fails with "Nest can't resolve dependencies of X (?)". swc reads the real
 * tsconfig, emits the metadata, and the container resolves normally.
 * `test/app.e2e.test.ts` is the canary for exactly this.
 */
export default defineConfig({
  plugins: [swc.vite()],
  resolve: {
    // Native replacement for vite-tsconfig-paths: picks up the `@/*` mapping.
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    // Runs before any test module is imported, so app.module.ts can validate.
    setupFiles: ['./test/setup-env.ts'],
  },
});
