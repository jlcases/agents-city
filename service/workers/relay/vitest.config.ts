import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: path.join(import.meta.dirname, 'wrangler.jsonc') },
      miniflare: {
        bindings: {
          APP_ENV: 'test',
          ROADS_CONTROL_SECRET: 'test-control-secret-with-more-than-32-characters',
          SEALED_CAPABILITY_PEPPER_VERSION: '1',
          SEALED_CAPABILITY_PEPPER_CURRENT: 'test-sealed-capability-pepper-with-more-than-32-characters',
          TRANSPARENCY_OPERATOR_KEY_ID: 'operator-test-1',
          TRANSPARENCY_OPERATOR_PRIVATE_JWK: '{"key_ops":["sign"],"ext":true,"alg":"Ed25519","crv":"Ed25519","d":"LSglMmAe_V9PryBFeZSnRihhApJL4mDl-diLPAlym9g","x":"-nK6xFMo1grVNo49ZnowjO6-RCVZRIBDU6NHFtVoFSo","kty":"OKP"}',
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, '../../migrations/control-plane')),
        },
      },
    })),
  ],
  test: {
    include: ['workers/relay/test/**/*.spec.ts'],
    exclude: ['workers/relay/test/load.spec.ts'],
    setupFiles: ['workers/relay/test/setup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
