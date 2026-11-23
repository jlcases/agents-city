#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClientArtifact } from './lib/bundle-connect-client.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const targetArgument = process.argv.indexOf('--target');
if (targetArgument < 0 || !process.argv[targetArgument + 1]) {
  throw new Error('usage: npm run export:public-client -- --target /path/to/agents-city');
}

const targetRoot = await realpath(resolve(process.argv[targetArgument + 1]));
const packageValue = JSON.parse(await readFile(join(targetRoot, 'package.json'), 'utf8'));
if (packageValue.name !== 'agents-city') throw new Error('target_is_not_agents_city');

const outputDirectory = join(targetRoot, 'plugin', 'channel');
const artifact = await buildClientArtifact({
  root: ROOT,
  prefix: 'agents-city-public-client-',
  external: ['@napi-rs/keyring'],
  source: [
    `export * from ${JSON.stringify(join(ROOT, 'packages/connect-client/src/index.ts'))};`,
    `export * from ${JSON.stringify(join(ROOT, 'packages/connect-client/src/node.ts'))};`,
  ].join('\n'),
});

const files = [
  {
    source: artifact.outfile,
    destination: join(outputDirectory, 'managed-connect-client.js'),
  },
  {
    source: join(ROOT, 'scripts/templates/managed-connect-client.d.ts'),
    destination: join(outputDirectory, 'managed-connect-client.d.ts'),
  },
  {
    source: join(ROOT, 'config/sandbox-key-transparency-root-chain.json'),
    destination: join(outputDirectory, 'trust', 'agents-city-sandbox-roots.json'),
  },
  {
    source: join(ROOT, 'node_modules/@kinsh/vodozemac-wasm/pkg-node/kinsh_vodozemac_wasm_bg.wasm'),
    destination: join(outputDirectory, 'kinsh_vodozemac_wasm_bg.wasm'),
  },
  {
    source: join(ROOT, 'packages/hybrid-crypto/pkg/agents_city_hybrid_crypto_bg.wasm'),
    destination: join(outputDirectory, 'agents_city_hybrid_crypto_bg.wasm'),
  },
  {
    source: join(ROOT, 'packages/connect-client/THIRD_PARTY_NOTICES.md'),
    destination: join(outputDirectory, 'licenses', 'CONNECT_CLIENT_THIRD_PARTY_NOTICES.md'),
  },
  {
    source: join(ROOT, 'packages/connect-client/licenses/keyring-MIT.txt'),
    destination: join(outputDirectory, 'licenses', 'keyring-MIT.txt'),
  },
  {
    source: join(ROOT, 'packages/connect-client/licenses/vodozemac-Apache-2.0.txt'),
    destination: join(outputDirectory, 'licenses', 'vodozemac-Apache-2.0.txt'),
  },
  {
    source: join(ROOT, 'packages/hybrid-crypto/LICENSE-Apache-2.0.txt'),
    destination: join(outputDirectory, 'licenses', 'hybrid-crypto-Apache-2.0.txt'),
  },
  {
    source: join(ROOT, 'packages/hybrid-crypto/THIRD_PARTY_NOTICES.md'),
    destination: join(outputDirectory, 'licenses', 'HYBRID_CRYPTO_THIRD_PARTY_NOTICES.md'),
  },
];

await mkdir(join(outputDirectory, 'licenses'), { recursive: true });
await mkdir(join(outputDirectory, 'trust'), { recursive: true });
for (const file of files) {
  const metadata = await stat(file.source);
  if (!metadata.isFile() || metadata.size < 1) throw new Error(`invalid_export_source:${file.source}`);
  await copyFile(file.source, file.destination);
}

const sha256 = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const sourceFiles = [
  'packages/connect-client/src/device.ts',
  'packages/connect-client/src/encoding.ts',
  'packages/connect-client/src/hybrid-crypto.ts',
  'packages/connect-client/src/index.ts',
  'packages/connect-client/src/keyring-secret.ts',
  'packages/connect-client/src/node-persistence.ts',
  'packages/connect-client/src/node.ts',
  'packages/connect-client/src/ratchet.ts',
  'packages/connect-client/src/relay-session.ts',
  'packages/connect-client/src/road.ts',
  'packages/connect-client/src/sealed-client.ts',
  'packages/service-protocol/src/index.ts',
  'packages/service-protocol/src/hybrid-establishment.ts',
  'packages/service-protocol/src/key-transparency.ts',
  'packages/service-protocol/src/key-transparency-root.ts',
  'packages/service-protocol/src/key-transparency-root-chain.ts',
  'packages/service-protocol/src/sealed-sender.ts',
  'packages/service-protocol/src/validation.ts',
  'scripts/templates/managed-connect-client.d.ts',
  'config/sandbox-key-transparency-root-chain.json',
];
const sourceDigests = Object.fromEntries(await Promise.all(sourceFiles.map(async (path) => [
  path,
  await sha256(join(ROOT, path)),
])));
const exported = Object.fromEntries(await Promise.all(files.map(async (file) => [
  file.destination.slice(targetRoot.length + 1),
  await sha256(file.destination),
])));
const manifest = {
  protocol: 'agents-city-public-connect-client/1',
  generatedFrom: 'agents-city-web',
  sourceFiles: sourceDigests,
  exported,
};
await writeFile(
  join(outputDirectory, 'managed-connect-client.manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o644 },
);
await rm(artifact.directory, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, targetRoot, exported }, null, 2));
