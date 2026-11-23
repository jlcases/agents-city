import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const execFileAsync = promisify(execFile);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));

test('the ratchet uses an exact Apache-2.0 dependency and no libsignal code', async () => {
  const manifest = await readJson('package.json');
  const clientManifest = await readJson('packages/connect-client/package.json');
  const lock = await readJson('package-lock.json');
  assert.equal(manifest.dependencies['@kinsh/vodozemac-wasm'], '0.4.2');
  assert.equal(manifest.dependencies['@napi-rs/keyring'], '1.3.0');
  assert.equal(clientManifest.dependencies['@kinsh/vodozemac-wasm'], '0.4.2');
  assert.equal(clientManifest.dependencies['@napi-rs/keyring'], '1.3.0');
  assert.equal(
    lock.packages['node_modules/@kinsh/vodozemac-wasm'].license,
    'Apache-2.0',
  );
  assert.equal(lock.packages['node_modules/@napi-rs/keyring'].license, 'MIT');
  assert.equal(lock.packages['node_modules/@kinsh/vodozemac-wasm'].dependencies, undefined);
  for (const [path, dependency] of Object.entries(lock.packages)) {
    if (path.startsWith('node_modules/@napi-rs/keyring-')) {
      assert.equal(dependency.license, 'MIT', `${path} must remain MIT-licensed`);
    }
  }
  for (const forbidden of ['@signalapp/libsignal-client', 'libsignal', 'signal-protocol']) {
    assert.equal(manifest.dependencies[forbidden], undefined);
  }
  const source = await readFile(new URL('packages/connect-client/src/ratchet.ts', root), 'utf8');
  const nodeSource = await readFile(new URL('packages/connect-client/src/node-persistence.ts', root), 'utf8');
  const keyringLicense = await readFile(
    new URL('packages/connect-client/licenses/keyring-MIT.txt', root),
    'utf8',
  );
  const vodozemacLicense = await readFile(
    new URL('packages/connect-client/licenses/vodozemac-Apache-2.0.txt', root),
    'utf8',
  );
  assert.match(source, /@kinsh\/vodozemac-wasm/);
  assert.doesNotMatch(source, /@signalapp|libsignal/);
  assert.match(nodeSource, /@napi-rs\/keyring/);
  assert.match(keyringLicense, /Copyright \(c\) 2020 N-API for Rust/);
  assert.match(keyringLicense, /Permission is hereby granted, free of charge/);
  assert.match(vodozemacLicense, /Apache License/);
  assert.match(vodozemacLicense, /Version 2\.0, January 2004/);
});

test('the hybrid ML-KEM artifact is pinned, reproducible, noticed, and licence-compatible', async () => {
  const cargoManifest = await readFile(new URL('packages/hybrid-crypto/Cargo.toml', root), 'utf8');
  const cargoLock = await readFile(new URL('packages/hybrid-crypto/Cargo.lock', root), 'utf8');
  const rustSource = await readFile(new URL('packages/hybrid-crypto/src/lib.rs', root), 'utf8');
  const notices = await readFile(
    new URL('packages/hybrid-crypto/THIRD_PARTY_NOTICES.md', root),
    'utf8',
  );
  const apacheLicense = await readFile(
    new URL('packages/hybrid-crypto/LICENSE-Apache-2.0.txt', root),
    'utf8',
  );
  for (const dependency of [
    ['aes-gcm', '0.10.3'],
    ['hkdf', '0.12.4'],
    ['libcrux-ml-kem', '0.0.10'],
    ['sha2', '0.10.9'],
    ['wasm-bindgen', '0.2.104'],
    ['zeroize', '1.9.0'],
  ]) {
    assert.match(
      cargoManifest,
      new RegExp(`${dependency[0].replace('-', '\\-')}\\s*=\\s*\\{?[^\\n]*=${dependency[1].replaceAll('.', '\\.')}[^\\n]*`),
      `${dependency[0]} must remain pinned exactly`,
    );
    assert.match(notices, new RegExp(`\\b${dependency[0]} ${dependency[1].replaceAll('.', '\\.')}\\b`));
  }
  assert.match(cargoLock, /name = "libcrux-ml-kem"\nversion = "0\.0\.10"\nsource = "registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index"\nchecksum = "[a-f0-9]{64}"/);
  assert.match(rustSource, /#!\[deny\(unsafe_code\)\]/);
  assert.doesNotMatch(rustSource, /\bunsafe\s*\{/);
  assert.match(apacheLicense, /Apache License/);
  assert.match(apacheLicense, /Version 2\.0, January 2004/);

  const { stdout } = await execFileAsync('cargo', [
    'metadata',
    '--locked',
    '--offline',
    '--format-version',
    '1',
    '--manifest-path',
    'packages/hybrid-crypto/Cargo.toml',
  ], { cwd: fileURLToPath(root), maxBuffer: 8 * 1024 * 1024 });
  const metadata = JSON.parse(stdout);
  const approvedExpressions = new Set([
    'Apache-2.0',
    'MIT',
    'MIT OR Apache-2.0',
    'Apache-2.0 OR MIT',
    'MIT/Apache-2.0',
    'Apache-2.0/MIT',
    'BSD-3-Clause',
    'ISC',
    'Unlicense OR MIT',
    '(MIT OR Apache-2.0) AND Unicode-3.0',
    'MIT OR Apache-2.0 OR LGPL-2.1-or-later',
  ]);
  for (const dependency of metadata.packages) {
    assert.ok(dependency.license, `${dependency.name} must declare an SPDX licence`);
    assert.ok(
      approvedExpressions.has(dependency.license),
      `${dependency.name} ${dependency.version} has unreviewed licence ${dependency.license}`,
    );
  }
  const libcrux = metadata.packages.find((dependency) => dependency.name === 'libcrux-ml-kem');
  assert.equal(libcrux?.version, '0.0.10');
  assert.equal(libcrux?.license, 'Apache-2.0');

  const checksums = await readFile(
    new URL('packages/hybrid-crypto/pkg/SHA256SUMS', root),
    'utf8',
  );
  const shippedArtifacts = [
    'README.md',
    'agents_city_hybrid_crypto.d.ts',
    'agents_city_hybrid_crypto.js',
    'agents_city_hybrid_crypto_bg.wasm',
    'agents_city_hybrid_crypto_bg.wasm.d.ts',
    'package.json',
  ];
  const recorded = new Map(checksums.trim().split('\n').map((line) => {
    const match = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/);
    assert.ok(match, `invalid SHA256SUMS entry: ${line}`);
    return [match[2], match[1]];
  }));
  assert.deepEqual([...recorded.keys()], shippedArtifacts);
  for (const artifact of shippedArtifacts) {
    const bytes = await readFile(new URL(`packages/hybrid-crypto/pkg/${artifact}`, root));
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(
      recorded.get(artifact),
      digest,
      `${artifact} changed without an explicit reviewed checksum update`,
    );
  }
});

test('coverage-guided fuzz tooling is exact, development-only, and licence-reviewed', async () => {
  const manifest = await readJson('package.json');
  const lock = await readJson('package-lock.json');
  const fuzzManifest = await readFile(
    new URL('packages/hybrid-crypto/fuzz/Cargo.toml', root),
    'utf8',
  );
  const notices = await readFile(new URL('fuzz/THIRD_PARTY_NOTICES.md', root), 'utf8');
  assert.equal(manifest.devDependencies['@jazzer.js/core'], '4.0.0');
  assert.equal(manifest.dependencies['@jazzer.js/core'], undefined);
  assert.equal(lock.packages['node_modules/@jazzer.js/core'].version, '4.0.0');
  assert.equal(lock.packages['node_modules/@jazzer.js/core'].dev, true);
  assert.equal(lock.packages['node_modules/@jazzer.js/core'].license, 'Apache-2.0');
  assert.match(fuzzManifest, /libfuzzer-sys = "=0\.4\.13"/);
  assert.match(notices, /@jazzer\.js\/core 4\.0\.0/);
  assert.match(notices, /libfuzzer-sys 0\.4\.13/);

  const { stdout } = await execFileAsync('cargo', [
    'metadata',
    '--locked',
    '--offline',
    '--format-version',
    '1',
    '--manifest-path',
    'packages/hybrid-crypto/fuzz/Cargo.toml',
  ], { cwd: fileURLToPath(root), maxBuffer: 8 * 1024 * 1024 });
  const metadata = JSON.parse(stdout);
  const libfuzzer = metadata.packages.find((dependency) => dependency.name === 'libfuzzer-sys');
  assert.equal(libfuzzer?.version, '0.4.13');
  assert.equal(libfuzzer?.license, '(MIT OR Apache-2.0) AND NCSA');
});
