import path from 'node:path';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: path.join(import.meta.dirname, 'wrangler.jsonc') },
      miniflare: {
        bindings: {
          OPERATOR_KEY_ID: 'operator-test-1',
          OPERATOR_PUBLIC_JWK: '{"kty":"OKP","crv":"Ed25519","x":"-nK6xFMo1grVNo49ZnowjO6-RCVZRIBDU6NHFtVoFSo","ext":true}',
          WITNESS_KEY_ID: 'witness-test-1',
          WITNESS_PRIVATE_JWK: '{"kty":"OKP","crv":"Ed25519","d":"727O45rhM4z0AZU8SDrGW8Ut_YZhUoxjHbJwGqc1bx4","x":"on9vnn9UXWuYPIwQDF6iWq5i2b6Tg4s1vgZMvHIY4Ko","ext":true}',
          RELAY_ACCOUNT_ID: '11111111111111111111111111111111',
          WITNESS_ACCOUNT_ID: '22222222222222222222222222222222',
          WITNESS_DEPLOYMENT_ID: '00000000-0000-4000-8000-000000000001',
          WITNESS_SOURCE_COMMIT: '0000000000000000000000000000000000000000',
        },
      },
    }),
  ],
  test: {
    include: ['workers/transparency-witness/test/**/*.spec.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
