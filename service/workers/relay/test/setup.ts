import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { initializeHybridCrypto } from '../../../packages/connect-client/src/hybrid-crypto';
import hybridCryptoWasm from '../../../packages/hybrid-crypto/pkg/agents_city_hybrid_crypto_bg.wasm';

await initializeHybridCrypto(hybridCryptoWasm);

await applyD1Migrations(env.CONTROL, env.TEST_MIGRATIONS);
