import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: path.join(import.meta.dirname, 'wrangler.jsonc') },
      miniflare: {
        bindings: {
          ROADS_CONTROL_SECRET: 'test-control-secret-with-more-than-32-characters',
          SEALED_CAPABILITY_PEPPER_VERSION: '1',
          SEALED_CAPABILITY_PEPPER_CURRENT: 'test-sealed-capability-pepper-with-more-than-32-characters',
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, '../../migrations/control-plane'),
          ),
        },
      },
    })),
  ],
  test: {
    include: ['workers/relay/test/load.spec.ts'],
    setupFiles: ['workers/relay/test/setup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
