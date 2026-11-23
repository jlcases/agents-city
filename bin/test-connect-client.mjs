#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  HYBRID_ESTABLISHMENT_SUITE,
  KEY_TRANSPARENCY_PROTOCOL,
  KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL,
  KEY_TRANSPARENCY_ROOT_PROTOCOL,
  RELAY_PROTOCOL,
  SEALED_DELIVERY_PROTOCOL,
  SEALED_SUITE,
  createHybridSenderSecret,
  createKeyTransparencyRootSignature,
  createRoadEnvelope,
  createSealedRoadSubmission,
  deriveHybridRecipientSecret,
  generateDeviceKeys,
  generateMlKem768Prekey,
  hashKeyTransparencyRoot,
  initializeHybridCrypto,
  openHybridEstablishment,
  openRoadEnvelope,
  openSealedRoadDelivery,
  randomHybridNonce,
  randomKemEncapsulation,
  sealHybridEstablishment,
  wipeHybridSecret,
} from '../plugin/channel/managed-connect-client.js';

const ROOT = new URL('..', import.meta.url).pathname;
const CLI = new URL('../plugin/channel/managed-connect-cli.js', import.meta.url).pathname;
const checks = [];
const check = (name, condition, detail = '') => {
  assert.ok(condition, `${name}${detail ? `: ${detail}` : ''}`);
  checks.push(name);
};
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const b64 = (bytes = 32) => randomBytes(bytes).toString('base64url');
const publicJwk = (jwk) => ({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, ext: true });

function exportedArtifactBoundary() {
  const manifestPath = join(ROOT, 'plugin/channel/managed-connect-client.manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  check('the generated public artifact has a versioned provenance manifest',
    manifest.protocol === 'agents-city-public-connect-client/1');
  check('every exported runtime asset matches its recorded SHA-256',
    Object.entries(manifest.exported).every(([path, expected]) => (
      digest(join(ROOT, path)) === expected
    )));
  const declarations = readFileSync(
    join(ROOT, 'plugin/channel/managed-connect-client.d.ts'), 'utf8',
  );
  check('the public API makes durable outbound acceptance explicit',
    declarations.includes('onAccepted?') && declarations.includes('messageId?: string'));
  const runtime = readFileSync(join(ROOT, 'plugin/channel/managed-connect-client.js'), 'utf8');
  check('the shipped runtime is relay v4 and contains no relay v2 fallback',
    runtime.includes('agents-city-relay/4') && !runtime.includes('agents-city-relay/2'));
  check('temporary admission failures get two bounded same-envelope retries',
    runtime.includes('attempt < 3')
      && runtime.includes('code === "mailbox_full" ? 5e3 : 2e3')
      && runtime.includes('error.code === "delivery_unavailable"')
      && runtime.includes('error.code === "mailbox_full"'));
  const sandboxRoots = readFileSync(
    join(ROOT, 'plugin/channel/trust/agents-city-sandbox-roots.json'),
    'utf8',
  );
  check('the managed sandbox pin ships as public versioned root metadata',
    sandboxRoots.includes('agents-city-key-transparency-root-chain/1')
      && !sandboxRoots.includes('"d"'));
}

function documentationBoundary() {
  const managed = readFileSync(join(ROOT, 'docs/managed-connect.md'), 'utf8');
  const security = readFileSync(join(ROOT, 'docs/security.md'), 'utf8');
  const english = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const spanish = readFileSync(join(ROOT, 'README.es.md'), 'utf8');
  const publicWords = `${managed}\n${security}\n${english}\n${spanish}`;
  check('public documentation names relay v4 and its three limited privacy claims',
    managed.includes('agents-city-relay/4')
      && managed.includes('sealed delivery')
      && managed.includes('key transparency')
      && managed.includes('hybrid post-quantum session establishment'));
  check('public documentation describes the OS-protected encrypted vault',
    managed.includes('macOS Keychain')
      && /Windows Credential\s+Manager/.test(managed)
      && /Linux Secret\s+Service/.test(managed)
      && managed.includes('no plaintext fallback'));
  check('public documentation keeps production and local-at-rest limits explicit',
    managed.includes('not production-enabled')
      && managed.includes('not itself application-level encrypted')
      && managed.includes('independent security audit'));
  check('public documentation explains bounded admission recovery',
    managed.includes('at most two more attempts')
      && /same\s+encrypted envelope/.test(managed));
  check('both READMEs require a signed root chain in first-pairing examples',
    english.includes('--service https://connect.example.com --trust-file roots.json')
      && spanish.includes('--service https://connect.example.com --trust-file roots.json'));
  check('obsolete HPKE and relay-v2 documentation is gone',
    !/\bHPKE\b|protocol[- ]v?2|managed-connect-(?:core)|managed-connect\/(?:protocol|hpke|road)\.ts/.test(publicWords));
}

const identity = (keys, owner) => ({
  ...keys,
  deviceId: randomUUID(),
  ownerPrefix: owner,
  relayUrl: 'wss://relay.example.test/v1/connect',
  keyVersion: 1,
});

const roadPair = (left, right) => {
  const id = randomUUID();
  const leftEncryptionKeyId = b64();
  const rightEncryptionKeyId = b64();
  const common = { id, revision: 1, establishmentSuite: SEALED_SUITE };
  return [
    {
      ...common,
      localCity: 'alice/product',
      peerCity: 'bob/engineering',
      localEncryptionKeyId: leftEncryptionKeyId,
      peerEncryptionKeyId: rightEncryptionKeyId,
      peerSigningPublicJwk: publicJwk(right.signingPublicJwk),
      peerEncryptionPublicJwk: publicJwk(right.encryptionPublicJwk),
      ratchetRole: 'initiator',
      peerDeviceId: right.deviceId,
      peerRatchetIdentityKey: right.ratchetBundle.identityKey,
      peerRatchetSigningKey: right.ratchetBundle.signingKey,
      peerOneTimeKeyId: right.ratchetBundle.oneTimeKeys[0].id,
      peerOneTimeKey: right.ratchetBundle.oneTimeKeys[0].key,
      peerHybridPrekey: null,
      localHybridPrekeyId: null,
    },
    {
      ...common,
      localCity: 'bob/engineering',
      peerCity: 'alice/product',
      localEncryptionKeyId: rightEncryptionKeyId,
      peerEncryptionKeyId: leftEncryptionKeyId,
      peerSigningPublicJwk: publicJwk(left.signingPublicJwk),
      peerEncryptionPublicJwk: publicJwk(left.encryptionPublicJwk),
      ratchetRole: 'responder',
      peerDeviceId: left.deviceId,
      peerRatchetIdentityKey: left.ratchetBundle.identityKey,
      peerRatchetSigningKey: left.ratchetBundle.signingKey,
      peerOneTimeKeyId: left.ratchetBundle.oneTimeKeys[0].id,
      peerOneTimeKey: left.ratchetBundle.oneTimeKeys[0].key,
      peerHybridPrekey: null,
      localHybridPrekeyId: null,
    },
  ];
};

async function cryptoBoundary() {
  await initializeHybridCrypto();
  const left = identity(await generateDeviceKeys(), 'alice');
  const right = identity(await generateDeviceKeys(), 'bob');
  check('device signing and encryption private keys are generated locally',
    Boolean(left.signingPrivateJwk.d) && Boolean(left.encryptionPrivateJwk.d));
  check('each device stages ML-KEM-768 one-time prekeys',
    left.hybridPrekeys.length > 0
      && Buffer.from(left.hybridPrekeys[0].publicKey, 'base64url').byteLength === 1_184
      && HYBRID_ESTABLISHMENT_SUITE.includes('MLKEM768'));

  const prekey = await generateMlKem768Prekey();
  const sender = await createHybridSenderSecret(right.encryptionPublicJwk);
  const recipientSecret = await deriveHybridRecipientSecret(
    right.encryptionPrivateJwk,
    sender.ephemeralKey,
  );
  const nonce = randomHybridNonce();
  const randomness = randomKemEncapsulation();
  const transcript = 'agents-city-public-export-test/1';
  const hybridPlaintext = 'post-quantum establishment belongs to the two endpoints';
  const hybridCiphertext = sealHybridEstablishment(
    prekey.publicKey,
    sender.classicalSecret,
    transcript,
    hybridPlaintext,
    randomness,
    nonce,
  );
  check('hybrid X25519 plus ML-KEM establishment exposes no plaintext',
    !hybridCiphertext.includes(hybridPlaintext));
  check('the generated public artifact opens its hybrid establishment',
    openHybridEstablishment(
      prekey.seed,
      recipientSecret,
      transcript,
      hybridCiphertext,
      nonce,
    ) === hybridPlaintext);
  assert.throws(() => openHybridEstablishment(
    prekey.seed,
    recipientSecret,
    `${transcript}/substituted`,
    hybridCiphertext,
    nonce,
  ));
  checks.push('hybrid ciphertext is bound to its signed transcript');
  wipeHybridSecret(sender.classicalSecret);
  wipeHybridSecret(recipientSecret);
  wipeHybridSecret(randomness);
  wipeHybridSecret(nonce);

  const [leftRoad, rightRoad] = roadPair(left, right);
  const text = 'Review the screenshot before merging this change.';
  const envelope = await createRoadEnvelope(left, leftRoad, text);
  check('signed Road ciphertext contains no application plaintext',
    !JSON.stringify(envelope).includes(text));
  const opened = await openRoadEnvelope(right, rightRoad, envelope);
  check('only the intended Road endpoint opens the signed message',
    opened.status === 'pending' && opened.kind === 'text' && opened.text === text);
  await right.ratchet.commitInbound(rightRoad.id, envelope.id, rightRoad.revision);

  const now = Date.now();
  const registrations = await right.ratchet.ensureInboundSealedCapabilities(
    rightRoad.id, rightRoad.revision, 3, now,
  );
  await right.ratchet.confirmInboundSealedCapabilities(
    registrations.map(({ receiptTag }) => receiptTag), now,
  );
  const capabilities = await right.ratchet.unsharedInboundSealedCapabilities(
    rightRoad.id, rightRoad.revision, now,
  );
  await left.ratchet.acceptOutboundSealedCapabilities(
    leftRoad.id, leftRoad.revision, capabilities, now,
  );
  const messageId = randomUUID();
  const sealed = await createSealedRoadSubmission(left, leftRoad, text, {
    messageId,
    now: now + 1,
  });
  check('a stable application id becomes the sealed submission id',
    sealed.submission.id === messageId);
  const remaining = await left.ratchet.outboundSealedCapabilityCount(
    leftRoad.id, leftRoad.revision, now + 1,
  );
  const retried = await createSealedRoadSubmission(left, leftRoad, text, {
    messageId,
    now: now + 10_000,
  });
  check('a crash retry returns the exact same sealed ciphertext and capability',
    JSON.stringify(retried) === JSON.stringify(sealed));
  check('an exact retry does not advance the ratchet or consume another capability',
    await left.ratchet.outboundSealedCapabilityCount(
      leftRoad.id, leftRoad.revision, now + 10_000,
    ) === remaining);
  await assert.rejects(createSealedRoadSubmission(left, leftRoad, `${text} changed`, {
    messageId,
    now: now + 10_001,
  }), /sealed_message_id_conflict/);
  checks.push('the same application id cannot be rebound to changed text');

  const delivery = {
    protocol: SEALED_DELIVERY_PROTOCOL,
    id: sealed.submission.id,
    receiptTag: sealed.receiptTag,
    receivedAt: now + 2,
    expiresAt: now + 60_000,
    payload: sealed.submission.payload,
  };
  const sealedOpened = await openSealedRoadDelivery(right, rightRoad, delivery, now + 3);
  check('sealed sender hides routing metadata while the recipient still opens the text',
    sealedOpened.status === 'pending' && sealedOpened.text === text
      && !JSON.stringify(sealed.submission).includes(leftRoad.localCity));
  await right.ratchet.commitInbound(rightRoad.id, messageId, rightRoad.revision);
  await right.ratchet.commitInboundSealedCapability(sealed.receiptTag, messageId);
  check('the receiver recognizes an exact sealed replay as a duplicate',
    (await openSealedRoadDelivery(right, rightRoad, delivery, now + 4)).status === 'duplicate');
}

const cli = (home, ...args) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8',
  env: { ...process.env, AGENTS_CITY_HOME: home },
});

const cliAsync = (home, ...args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [CLI, ...args], {
    env: { ...process.env, AGENTS_CITY_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', (status) => resolve({ status, stdout, stderr }));
});

function builtInPinBoundary() {
  const root = mkdtempSync(join(tmpdir(), 'agents-city-built-in-root-'));
  try {
    const result = cli(
      root,
      '--service',
      'https://agents-city-connect-sandbox.pages.dev',
      '--city',
      'intentionally-missing',
      '--no-open',
    );
    check('the official sandbox resolves its shipped root before any network pairing',
      result.status !== 0
        && result.stderr.includes('no local city called intentionally-missing')
        && !result.stderr.includes('ENOENT')
        && !result.stderr.includes('invalid_key_transparency_profile_file'),
      result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function localStateBoundary() {
  const root = mkdtempSync(join(tmpdir(), 'agents-city-connect-v4-'));
  try {
    const connect = join(root, '.runtime', 'connect');
    mkdirSync(connect, { recursive: true, mode: 0o700 });
    chmodSync(join(root, '.runtime'), 0o700);
    chmodSync(connect, 0o700);
    const [rootPair, operatorPair, witnessPair] = await Promise.all([
      crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']),
      crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']),
      crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']),
    ]);
    const rootPublic = publicJwk(await crypto.subtle.exportKey('jwk', rootPair.publicKey));
    const exportedRootPrivate = await crypto.subtle.exportKey('jwk', rootPair.privateKey);
    const rootPrivate = {
      kty: 'OKP', crv: 'Ed25519', x: exportedRootPrivate.x, d: exportedRootPrivate.d, ext: true,
    };
    const now = Date.now();
    const trustRoot = {
      protocol: KEY_TRANSPARENCY_ROOT_PROTOCOL,
      version: 1,
      environment: 'production',
      controlPlaneUrl: 'https://connect.example.test',
      relayUrl: 'wss://relay.example.test/v1/connect',
      issuedAt: now,
      expiresAt: now + 90 * 24 * 60 * 60_000,
      previousRootHash: null,
      keys: {
        'offline-root-test-1': rootPublic,
        'operator-test-1': publicJwk(await crypto.subtle.exportKey('jwk', operatorPair.publicKey)),
        'witness-test-1': publicJwk(await crypto.subtle.exportKey('jwk', witnessPair.publicKey)),
      },
      roles: {
        root: { keyIds: ['offline-root-test-1'], threshold: 1 },
        operator: { keyIds: ['operator-test-1'], threshold: 1 },
        witness: { keyIds: ['witness-test-1'], threshold: 1 },
      },
      maximumHeadAgeMs: 300_000,
      maximumWitnessLagMs: 60_000,
    };
    const rootEnvelope = {
      signed: trustRoot,
      signatures: [await createKeyTransparencyRootSignature(
        trustRoot,
        'offline-root-test-1',
        rootPrivate,
      )],
    };
    const state = {
      protocol: 'agents-city-connect-state/3',
      status: 'connected',
      serviceUrl: 'https://connect.example.test',
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      device: {
        deviceId: randomUUID(),
        ownerPrefix: 'alice',
        relayUrl: 'wss://relay.example.test/v1/connect',
        keyVersion: 1,
      },
      keyTransparency: {
        root: rootEnvelope,
      },
      cities: [{
        localCityId: 'city_local_1234',
        dataDir: join(root, 'city'),
        slug: 'product',
        name: 'Product',
        remoteAddress: 'alice/product',
        encryptionKeyId: b64(),
        connected: true,
      }],
    };
    const path = join(connect, 'device.json');
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    check('the public connect state directory is private',
      (lstatSync(connect).mode & 0o777) === 0o700);
    check('the public connect state file is owner-only',
      (lstatSync(path).mode & 0o777) === 0o600);
    const status = cli(root, 'status', '--json');
    check('the public CLI reads a v4-compatible keyless device assignment',
      status.status === 0
        && JSON.parse(status.stdout).deviceId === state.device.deviceId
        && JSON.parse(status.stdout).trustRootVersion === 1,
      status.stderr);
    check('device.json and status output contain no private JWK material',
      !readFileSync(path, 'utf8').includes('"d"') && !status.stdout.includes('"d"'));

    writeFileSync(path, JSON.stringify({ protocol: 'agents-city-connect-state/1', identity: {} }), {
      mode: 0o600,
    });
    check('legacy plaintext-key state is refused instead of migrated silently',
      cli(root, 'status', '--json').stderr.includes('legacy_connect_state_contains_plaintext_keys'));
    writeFileSync(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    const tampered = structuredClone(state);
    tampered.keyTransparency.root.signatures[0].signature = b64(64);
    writeFileSync(path, `${JSON.stringify(tampered)}\n`, { mode: 0o600 });
    check('a persisted root with a forged signature is refused before network use',
      cli(root, 'status', '--json').stderr.includes(
        'insufficient_key_transparency_root_signatures',
      ));
    writeFileSync(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    writeFileSync(path, JSON.stringify({ protocol: 'agents-city-connect-state/2' }), {
      mode: 0o600,
    });
    check('unversioned online trust is refused instead of becoming a root silently',
      cli(root, 'status', '--json').stderr.includes(
        'connect_state_requires_versioned_trust_repairing',
      ));
    writeFileSync(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    chmodSync(path, 0o644);
    check('over-broad state permissions are refused',
      cli(root, 'status', '--json').stderr.includes('permissions_too_open'));
    chmodSync(path, 0o600);
    unlinkSync(path);
    const target = join(root, 'attacker-state.json');
    writeFileSync(target, JSON.stringify(state), { mode: 0o600 });
    symlinkSync(target, path);
    check('a symlinked device state is refused',
      cli(root, 'status', '--json').stderr.includes('unsafe_connect_state_file'));

    const unpaired = cli(join(root, 'unpaired'), '--no-open');
    check('first pairing never assumes an undeployed managed service',
      unpaired.status !== 0 && unpaired.stderr.includes('first pairing needs --service URL'));
    const help = cli(join(root, 'help'), '--help');
    check('the CLI explains PASCO approval and pinned trust before pairing',
      help.status === 0 && help.stdout.includes('PASCO') && help.stdout.includes('--trust-file'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function rootRefreshBoundary() {
  const appHome = mkdtempSync(join(tmpdir(), 'agents-city-root-refresh-'));
  let chain;
  const server = createServer((request, response) => {
    if (request.url === '/api/key-transparency/roots?from=1' && chain) {
      const body = JSON.stringify(chain);
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });
      response.end(body);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const serviceUrl = `http://127.0.0.1:${address.port}`;
    const relayUrl = `ws://127.0.0.1:${address.port}/v1/connect`;
    const [oldRootPair, newRootPair, operatorPair, witnessPair] = await Promise.all(
      Array.from({ length: 4 }, () => crypto.subtle.generateKey(
        { name: 'Ed25519' }, true, ['sign', 'verify'],
      )),
    );
    const strictPrivate = async (pair) => {
      const value = await crypto.subtle.exportKey('jwk', pair.privateKey);
      return { kty: 'OKP', crv: 'Ed25519', x: value.x, d: value.d, ext: true };
    };
    const now = Date.now();
    const common = {
      protocol: KEY_TRANSPARENCY_ROOT_PROTOCOL,
      environment: 'sandbox',
      controlPlaneUrl: serviceUrl,
      relayUrl,
      roles: {
        operator: { keyIds: ['operator-refresh-1'], threshold: 1 },
        witness: { keyIds: ['witness-refresh-1'], threshold: 1 },
      },
      maximumHeadAgeMs: 300_000,
      maximumWitnessLagMs: 30_000,
    };
    const onlineKeys = {
      'operator-refresh-1': publicJwk(await crypto.subtle.exportKey('jwk', operatorPair.publicKey)),
      'witness-refresh-1': publicJwk(await crypto.subtle.exportKey('jwk', witnessPair.publicKey)),
    };
    const first = {
      ...common,
      version: 1,
      issuedAt: now - 48 * 60 * 60_000,
      expiresAt: now - 60 * 60_000,
      previousRootHash: null,
      keys: {
        'root-refresh-old': publicJwk(await crypto.subtle.exportKey('jwk', oldRootPair.publicKey)),
        ...onlineKeys,
      },
      roles: {
        root: { keyIds: ['root-refresh-old'], threshold: 1 },
        ...common.roles,
      },
    };
    const firstEnvelope = {
      signed: first,
      signatures: [await createKeyTransparencyRootSignature(
        first,
        'root-refresh-old',
        await strictPrivate(oldRootPair),
      )],
    };
    const second = {
      ...common,
      version: 2,
      issuedAt: now - 1_000,
      expiresAt: now + 90 * 24 * 60 * 60_000,
      previousRootHash: await hashKeyTransparencyRoot(first),
      keys: {
        'root-refresh-new': publicJwk(await crypto.subtle.exportKey('jwk', newRootPair.publicKey)),
        ...onlineKeys,
      },
      roles: {
        root: { keyIds: ['root-refresh-new'], threshold: 1 },
        ...common.roles,
      },
    };
    const secondEnvelope = {
      signed: second,
      signatures: [
        await createKeyTransparencyRootSignature(
          second,
          'root-refresh-old',
          await strictPrivate(oldRootPair),
        ),
        await createKeyTransparencyRootSignature(
          second,
          'root-refresh-new',
          await strictPrivate(newRootPair),
        ),
      ],
    };
    chain = {
      protocol: KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL,
      roots: [firstEnvelope, secondEnvelope],
    };

    const connect = join(appHome, '.runtime', 'connect');
    mkdirSync(connect, { recursive: true, mode: 0o700 });
    chmodSync(join(appHome, '.runtime'), 0o700);
    chmodSync(connect, 0o700);
    const statePath = join(connect, 'device.json');
    writeFileSync(statePath, JSON.stringify({
      protocol: 'agents-city-connect-state/3',
      status: 'connected',
      serviceUrl,
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      device: {
        deviceId: randomUUID(),
        ownerPrefix: 'refresh',
        relayUrl,
        keyVersion: 1,
      },
      keyTransparency: { root: firstEnvelope },
      cities: [],
    }), { mode: 0o600 });

    const result = await cliAsync(
      appHome,
      '--service', serviceUrl,
      '--city', 'intentionally-missing',
      '--no-open',
    );
    const persisted = JSON.parse(readFileSync(statePath, 'utf8'));
    check('an expired cached root can advance only through a valid old-and-new transition',
      result.status !== 0
        && persisted.keyTransparency.root.signed.version === 2
        && !result.stderr.includes('expired_key_transparency_root'),
      result.stderr);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(appHome, { recursive: true, force: true });
  }
}

async function organizationsBoundary() {
  const out = mkdtempSync(join(tmpdir(), 'agents-city-orgs-'));
  try {
    const built = spawnSync(join(ROOT, 'plugin/channel/node_modules/.bin/esbuild'), [
      join(ROOT, 'plugin/channel/managed-connect/orgs.ts'),
      '--format=esm', '--platform=node', `--outfile=${join(out, 'orgs.mjs')}`, '--log-level=error',
    ], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    const source = readFileSync(join(ROOT, 'plugin/channel/managed-connect/orgs.ts'), 'utf8');
    check('the organization command surface imports no transport, keyring or crypto',
      !/^\s*import\s/m.test(source));
    const { organizationsCli, explainOrganizationError } = await import(join(out, 'orgs.mjs'));

    const run = async (args, answers = {}) => {
      const asked = [];
      const printed = [];
      let opened = 0;
      const open = async () => {
        opened += 1;
        return async (action, fields = {}) => {
          asked.push([action, fields]);
          const answer = answers[action];
          if (answer instanceof Error) throw answer;
          return answer;
        };
      };
      let error = null;
      try {
        await organizationsCli(args, { open, print: (line) => printed.push(line) });
      } catch (caught) {
        error = caught;
      }
      return { asked, printed: printed.join('\n'), opened, error };
    };
    const refused = (code, status = 409) => Object.assign(new Error(code), {
      name: 'ConnectApiError', code, status,
    });

    const created = await run(['create', 'acme', '--name', 'Acme'], {
      create: { organization: 'acme', name: 'Acme', plan: 'free', role: 'owner', members: 1 },
    });
    check('creating an organization sends its slug and display name and nothing else',
      JSON.stringify(created.asked) === JSON.stringify([['create', { organization: 'acme', name: 'Acme' }]])
        && created.printed.includes('You are its owner'), created.printed);

    for (const bad of [['create', 'Acme'], ['create', 'ra'], ['members', '../x'],
      ['connect', 'acme', 'Ana María'], ['role', 'acme', 'ana', 'owner'],
      ['invite', 'acme', '--uses', '500'], ['create'], ['frobnicate']]) {
      const result = await run(bad);
      check(`a malformed "orgs ${bad.join(' ')}" is refused before the service is reached`,
        result.error instanceof Error && result.opened === 0 && result.asked.length === 0,
        String(result.error));
    }

    for (const bad of [['join', ''], ['join', 'not-a-code'], ['join', 'org_short'],
      ['join', 'org_' + 'k'.repeat(40) + '\u001b[2J'],
      ['create', 'acme', '--name', 'x'.repeat(61)], ['create', 'acme', '--name', 'A\u001b[2J'],
      ['create', 'acme', '--name', ''], ['create', 'acme', '--name=Acme'],
      ['invite', 'acme', '--uses', ''], ['invite', 'acme', '--uses', '1e2'],
      ['invite', 'acme', '--uses', '0x10'], ['invite', 'acme', '--uses', '0'],
      ['invite', 'acme', '--uses', '5', '--uses', '50'], ['invite', 'acme', '--uses'],
      ['constructor'], ['toString', '--json'], ['__proto__'], ['hasOwnProperty']]) {
      const result = await run(bad);
      check(`a malformed "orgs ${JSON.stringify(bad).slice(0, 60)}" never reaches the service`,
        result.error instanceof Error && result.opened === 0 && result.asked.length === 0
          && !/is not (iterable|a function)/.test(String(result.error)),
        String(result.error));
    }
    const partly = await run(['remove', 'acme', 'ben'], {
      remove: { account: 'ben', connections: { closed: 1, closing: 0, failed: 2 } },
    });
    check('a removal that left connections open says so and how to finish it',
      partly.printed.includes('2 could not be closed')
        && partly.printed.includes('agents-city orgs remove acme ben'), partly.printed);
    const seats = await run(['members', 'acme'], {
      members: { organization: 'acme', members: [
        { account: 'eve', name: 'Eve', role: 'member', self: false, active: false, paired: true, connection: 'active' },
      ] },
    });
    check('a member whose account is suspended is listed as holding a seat',
      /eve\s+member\s+account suspended/.test(seats.printed), seats.printed);
    const stray = await run(['create', 'acme', '--name=Acme']);
    check('an option this command does not have is named, not counted as an argument',
      String(stray.error).includes('unknown option: --name=Acme'), String(stray.error));
    const twice = await run(['--json', 'list', '--json'], { list: { account: 'ana', organizations: [] } });
    check('--json may be given anywhere, and more than once',
      twice.error === null && JSON.parse(twice.printed).account === 'ana', String(twice.error));
    const stale = await run(['join', 'org_' + 'k'.repeat(48)], { join: {} });
    check('an answer missing what the command prints is an error, not "Joined undefined"',
      stale.error instanceof Error && !stale.printed.includes('undefined'), stale.printed);
    const brief = await run(['invite', 'acme'], {
      invite: { organization: 'acme', code: 'org_' + 'k'.repeat(48), uses: 1, expiresIn: 3600 },
    });
    check('a join code says how long the service said it lasts, not a fixed week',
      brief.printed.includes('1 person') && brief.printed.includes('60 minutes')
        && !brief.printed.includes('7 days'), brief.printed);
    const code = 'org_' + 'k'.repeat(48);
    const invited = await run(['invite', 'acme', '--uses', '10'], {
      invite: { organization: 'acme', code, uses: 10, expiresIn: 604800 },
    });
    check('a join code is printed once, with how many people it admits',
      invited.printed.includes(code) && invited.printed.includes('10 people')
        && invited.printed.includes('7 days')
        && JSON.stringify(invited.asked[0]) === JSON.stringify(['invite', { organization: 'acme', uses: 10 }]));

    const joined = await run(['join', code], { join: { organization: 'acme', role: 'member' } });
    const already = await run(['join', code], {
      join: { organization: 'acme', role: 'member', duplicate: true },
    });
    check('joining says which organization, and says when the code was not spent',
      joined.printed.includes('Joined acme as member') && already.printed.includes('was not used'));

    const listed = await run(['members', 'acme'], {
      members: {
        organization: 'acme',
        members: [
          { account: 'ana', name: 'Ana', role: 'owner', self: true, paired: true, connection: null },
          { account: 'ben', name: 'Ben', role: 'admin', self: false, paired: true, connection: 'active' },
          { account: 'cai', name: 'Cai', role: 'member', self: false, paired: true, connection: null },
          { account: 'dee', name: 'Dee', role: 'member', self: false, paired: false, connection: null },
        ],
      },
    });
    check('the member list tells each state apart: you, connected, not yet, no computer',
      /ana\s+owner\s+you/.test(listed.printed) && /ben\s+admin\s+connected/.test(listed.printed)
        && /cai\s+member\s+not connected yet/.test(listed.printed)
        && /dee\s+member\s+no computer paired/.test(listed.printed), listed.printed);

    const connected = await run(['connect', 'acme', 'ben'], {
      connect: { connection: { id: randomUUID(), status: 'provisioning' } },
    });
    check('connecting to a member says no approval was needed, and when the relay is not ready',
      connected.printed.includes('No approval was needed')
        && connected.printed.includes('still opening'), connected.printed);

    const left = await run(['leave', 'acme'], {
      remove: { account: 'ana', connections: { closed: 1, closing: 1 } },
    });
    const removed = await run(['remove', 'acme', 'ben'], {
      remove: { account: 'ben', connections: { closed: 2, closing: 0 } },
    });
    check('leaving names no account; removing names exactly one; both report closed connections',
      JSON.stringify(left.asked[0]) === JSON.stringify(['remove', { organization: 'acme' }])
        && JSON.stringify(removed.asked[0]) === JSON.stringify(['remove', { organization: 'acme', account: 'ben' }])
        && left.printed.includes('2 connection(s)') && left.printed.includes('are closing')
        && removed.printed.includes('Removed ben') && removed.printed.includes('are closed'));

    const json = await run(['list', '--json'], {
      list: { account: 'ana', organizations: [] },
    });
    const empty = await run(['list'], { list: { account: 'ana', organizations: [] } });
    check('--json prints the answer itself; without it an empty list says what to do next',
      JSON.parse(json.printed).account === 'ana' && empty.printed.includes('belongs to no organization'));

    const denied = await run(['invite', 'acme'], { invite: refused('forbidden', 403) });
    const unknown = await run(['invite', 'acme'], { invite: refused('some_new_code') });
    check('a refusal is explained in words, and an unknown one is passed through unchanged',
      explainOrganizationError(denied.error).includes('your role')
        && explainOrganizationError(unknown.error) === 'some_new_code');

    const help = await run(['--help']);
    check('help needs no account and reaches no service',
      help.printed.includes('agents-city orgs create') && help.opened === 0);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function accountDoors() {
  const home = mkdtempSync(join(tmpdir(), 'agents-city-auth-'));
  try {
    const front = readFileSync(join(ROOT, 'bin/agents-city.js'), 'utf8');
    check('the front door ships auth and orgs as their own commands',
      /auth: \{[\s\S]*?antes: \['auth'\]/.test(front) && /orgs: \{[\s\S]*?antes: \['orgs'\]/.test(front));
    const unsigned = cli(home, 'orgs', 'list');
    const status = cli(home, 'auth', 'status');
    check('an unsigned computer is told to sign in, by the command it ran',
      unsigned.status === 1 && unsigned.stderr.includes('agents-city orgs: this computer is not signed in')
        && status.status === 1 && status.stderr.includes('agents-city auth: this computer is not signed in'),
      unsigned.stderr + status.stderr);
    const nowhere = spawnSync(process.execPath, [CLI, 'auth', 'login', '--no-open'], {
      encoding: 'utf8',
      env: { ...process.env, AGENTS_CITY_HOME: home, AGENTS_CITY_CONNECT_URL: '' },
    });
    check('signing in with no service named is refused rather than guessed',
      nowhere.status === 1 && nowhere.stderr.includes('--sandbox') && nowhere.stderr.includes('--trust-file'),
      nowhere.stderr);
    const both = cli(home, 'auth', 'login', '--no-open', '--service', 'https://mine.example', '--sandbox');
    const pinned = cli(home, 'auth', 'login', '--no-open', '--sandbox', '--trust-file', '/nonexistent.json');
    check('the sandbox is not combined with another service or another root',
      both.status === 1 && both.stderr.includes('name two services')
        && pinned.status === 1 && pinned.stderr.includes('drop --trust-file'),
      both.stderr + pinned.stderr);
    const source = readFileSync(join(ROOT, 'plugin/channel/managed-connect/cli.ts'), 'utf8');
    check('signing in binds no city unless one is named, whether or not one exists',
      /const accountOnly = options\.identityOnly && !options\.selectors\.length && !options\.all;/
        .test(source));
    const code = 'org_' + 'k'.repeat(48);
    const where = ['--service', 'https://mine.example', '--trust-file', '/nonexistent.json'];
    const refusals = [
      [['auth', 'login', ...where, '--as', 'maria'], 'needs --join <code> or --bootstrap'],
      [['auth', 'login', ...where, '--join', code], 'name the account to create'],
      [['auth', 'login', ...where, '--join'], 'name the account to create'],
      [['auth', 'login', ...where, '--bootstrap'], 'name the account to create'],
      [['auth', 'login', ...where, '--as', 'maria', '--join', code, '--bootstrap'], 'two ways in'],
      [['auth', 'login', ...where, '--as', 'Maria Lopez', '--join', code], '--as needs an account handle'],
      [['auth', 'login', ...where, '--as', 'maria-', '--join', code], '--as needs an account handle'],
      [['auth', 'login', ...where, '--as', 'maria', '--join', '--bootstrap'], 'two ways in'],
      [['auth', 'login', ...where, '--as', 'maria', '--join', 'not-a-code'], '--join needs a join code'],
      // The connect door takes its options bare: there is no verb in front.
      [[...where, '--as', 'maria', '--join', code], 'belong to agents-city auth login'],
    ];
    for (const [args, said] of refusals) {
      const result = cli(home, ...args);
      const shown = args.filter((a) => !where.includes(a)).join(' ').replace(code, 'CODE');
      check(`"${args[0] === 'auth' ? shown : `connect ${shown}`}" is refused before any request`,
        result.status === 1 && result.stderr.includes(said), result.stderr);
    }
    const authHelp = cli(home, 'auth', '--help');
    check('auth help says an account made from the terminal has no passkey and how to get back in',
      authHelp.stdout.includes('--as HANDLE') && authHelp.stdout.includes('no passkey')
        && authHelp.stdout.includes('new invitation'), authHelp.stdout);
    const help = cli(home, 'auth', '--help');
    check('auth help states that no private key or reusable token leaves the computer',
      help.status === 0 && help.stdout.includes('no private key and no reusable token'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

check('the exported constants identify key transparency and relay v4',
  RELAY_PROTOCOL === 'agents-city-relay/4'
    && KEY_TRANSPARENCY_PROTOCOL === 'agents-city-key-transparency/1');
exportedArtifactBoundary();
documentationBoundary();
await cryptoBoundary();
builtInPinBoundary();
await localStateBoundary();
await rootRefreshBoundary();
await organizationsBoundary();
accountDoors();
console.log(JSON.stringify({ ok: true, checks: checks.length, names: checks }, null, 2));
