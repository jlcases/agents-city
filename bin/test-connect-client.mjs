#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CONNECT_STATE_PROTOCOL,
  ManagedRelaySession,
  bytesToBase64url,
  createRoadEnvelope,
  generateDeviceKeys,
  hexToBytes,
  hpkeOpenBase,
  hpkeSealBase,
  openRoadEnvelope,
  parseRelayServerFrame,
  readConnectState,
  textDecoder,
  writeConnectState,
} from '../plugin/channel/managed-connect-client.js';

const checks = [];
const check = (name, condition, detail = '') => {
  assert.ok(condition, `${name}${detail ? `: ${detail}` : ''}`);
  checks.push(name);
};

const eventually = async (predicate, timeout = 2_000) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition_timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const publicKeyId = () => randomBytes(32).toString('base64url');
const publicJwk = (jwk) => ({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, ext: true });

async function rfcVector() {
  const pkE = hexToBytes('37fda3567bdbd628e88668c3c8d7e97d1d1253b6d4ea6d44c150f741f1bf4431');
  const skE = hexToBytes('52c4a758a802cd8b936eceea314432798d5baf2d7e9235dc084ab1b9cfa2f736');
  const pkR = hexToBytes('3948cfe0ad1ddb695d780e59077195da6c56506b027329794ab02bca80815c4d');
  const skR = hexToBytes('4612c550263fc8ad58375df3f557aac531d26850903e55a9f23f21d8534e8ac8');
  const recipientPublic = { kty: 'OKP', crv: 'X25519', x: bytesToBase64url(pkR), ext: true };
  const recipientPrivate = {
    ...recipientPublic,
    d: bytesToBase64url(skR),
    key_ops: ['deriveBits'],
  };
  const ephemeral = {
    publicKey: await crypto.subtle.importKey('raw', pkE, { name: 'X25519' }, true, []),
    privateKey: await crypto.subtle.importKey('jwk', {
      kty: 'OKP', crv: 'X25519', x: bytesToBase64url(pkE), d: bytesToBase64url(skE),
      ext: true, key_ops: ['deriveBits'],
    }, { name: 'X25519' }, false, ['deriveBits']),
  };
  const plaintext = hexToBytes('4265617574792069732074727574682c20747275746820626561757479');
  const aad = hexToBytes('436f756e742d30');
  const info = hexToBytes('4f6465206f6e2061204772656369616e2055726e');
  const sealed = await hpkeSealBase(recipientPublic, plaintext, aad, { info, ephemeralKeyPair: ephemeral });
  check('HPKE matches RFC 9180 A.1.1 ciphertext', sealed.ciphertext === bytesToBase64url(hexToBytes(
    'f938558b5d72f1a23810b4be2ab4f84331acc02fc97babc53a52ae8218a355a96d8770ac83d07bea87e13c512a',
  )));
  check('HPKE RFC ciphertext opens', textDecoder.decode(await hpkeOpenBase(
    recipientPrivate, sealed.encapsulatedKey, sealed.ciphertext, aad, info,
  )) === 'Beauty is truth, truth beauty');
}

function identity(keys, owner = 'alice') {
  return {
    ...keys,
    deviceId: randomUUID(),
    ownerPrefix: owner,
    relayUrl: 'wss://relay.example.test/v1/connect',
    keyVersion: 1,
  };
}

async function storageBoundary() {
  const root = mkdtempSync(join(tmpdir(), 'agents-city-connect-state-'));
  try {
    const keys = await generateDeviceKeys();
    const state = {
      protocol: CONNECT_STATE_PROTOCOL,
      status: 'connected',
      serviceUrl: 'https://connect.example.test',
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      identity: identity(keys),
      cities: [{
        localCityId: 'city_local_1234',
        dataDir: join(root, 'city'),
        slug: 'home',
        name: 'Home',
        remoteAddress: 'alice/home',
        encryptionKeyId: publicKeyId(),
        connected: true,
      }],
    };
    writeConnectState(state, root);
    const directory = join(root, '.runtime', 'connect');
    const path = join(directory, 'device.json');
    check('managed key directory is 0700', (lstatSync(directory).mode & 0o777) === 0o700);
    check('managed identity file is 0600', (lstatSync(path).mode & 0o777) === 0o600);
    check('stored identity round-trips', readConnectState(root)?.status === 'connected');

    const cli = spawnSync(process.execPath, [
      new URL('../plugin/channel/managed-connect-cli.js', import.meta.url).pathname,
      'status', '--json',
    ], {
      encoding: 'utf8',
      env: { ...process.env, AGENTS_CITY_HOME: root },
    });
    check('status succeeds without exposing keys', cli.status === 0, cli.stderr);
    check('status output has no private JWK material', !cli.stdout.includes('"d"')
      && !cli.stdout.includes(String(keys.signingPrivateJwk.d))
      && !cli.stdout.includes(String(keys.encryptionPrivateJwk.d)));

    const unpaired = spawnSync(process.execPath, [
      new URL('../plugin/channel/managed-connect-cli.js', import.meta.url).pathname,
      '--no-open',
    ], {
      encoding: 'utf8',
      env: { ...process.env, AGENTS_CITY_HOME: join(root, 'unpaired') },
    });
    check('first pairing never assumes an undeployed public service', unpaired.status !== 0
      && unpaired.stderr.includes('first pairing needs --service URL'));

    chmodSync(path, 0o644);
    assert.throws(() => readConnectState(root), /permissions_too_open/);
    checks.push('over-broad key permissions are refused');
    chmodSync(path, 0o600);
    unlinkSync(path);
    const target = join(root, 'attacker.json');
    writeFileSync(target, JSON.stringify(state));
    symlinkSync(target, path);
    assert.throws(() => readConnectState(root), /unsafe_connect_state_file/);
    checks.push('managed state symlinks are refused');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

class MemoryTransport {
  sent = [];
  closed = [];
  message = () => {};
  closeHandler = () => {};
  send(raw) { this.sent.push(raw); }
  close(code, reason) { this.closed.push({ code, reason }); }
  onMessage(handler) { this.message = handler; }
  onClose(handler) { this.closeHandler = handler; }
  deliver(frame) { this.message(JSON.stringify(frame)); }
}

const directoryFrame = (city, road) => ({
  type: 'road_directory',
  snapshotId: randomUUID(),
  page: 1,
  pages: 1,
  roads: [road],
});

async function relayBoundary() {
  const left = identity(await generateDeviceKeys(), 'alice');
  const right = identity(await generateDeviceKeys(), 'bob');
  const leftKeyId = publicKeyId();
  const rightKeyId = publicKeyId();
  const roadId = randomUUID();
  const leftRoad = {
    id: roadId, revision: 1, localCity: 'alice/product', peerCity: 'bob/engineering',
    localEncryptionKeyId: leftKeyId, peerEncryptionKeyId: rightKeyId,
    peerSigningPublicJwk: publicJwk(right.signingPublicJwk),
    peerEncryptionPublicJwk: publicJwk(right.encryptionPublicJwk),
  };
  const rightRoad = {
    id: roadId, revision: 1, localCity: 'bob/engineering', peerCity: 'alice/product',
    localEncryptionKeyId: rightKeyId, peerEncryptionKeyId: leftKeyId,
    peerSigningPublicJwk: publicJwk(left.signingPublicJwk),
    peerEncryptionPublicJwk: publicJwk(left.encryptionPublicJwk),
  };
  const leftWire = new MemoryTransport();
  const rightWire = new MemoryTransport();
  let releaseLocal;
  const locallyAccepted = new Promise((resolve) => { releaseLocal = resolve; });
  let received;
  const leftSession = new ManagedRelaySession(left, 'alice/product', leftWire, {
    onText: () => { throw new Error('unexpected reverse text'); },
  });
  const rightSession = new ManagedRelaySession(right, 'bob/engineering', rightWire, {
    onText: async (message) => {
      received = message;
      await locallyAccepted;
    },
  });
  leftWire.deliver({ type: 'welcome', city: 'alice/product', deviceId: left.deviceId, protocol: 'agents-city-relay/1', roadCount: 1 });
  rightWire.deliver({ type: 'welcome', city: 'bob/engineering', deviceId: right.deviceId, protocol: 'agents-city-relay/1', roadCount: 1 });
  leftWire.deliver(directoryFrame('alice/product', leftRoad));
  rightWire.deliver(directoryFrame('bob/engineering', rightRoad));
  await Promise.all([leftSession.ready(), rightSession.ready()]);

  const text = 'Review screenshot https://example.test/pr/42 before merge';
  const directEnvelope = await createRoadEnvelope(left, leftRoad, text);
  check('signed Road ciphertext contains no plaintext', !JSON.stringify(directEnvelope).includes(text));
  check('the intended recipient opens the signed Road text', (await openRoadEnvelope(right, rightRoad, directEnvelope)).text === text);

  const sent = leftSession.sendRoadText(roadId, text);
  await eventually(() => leftWire.sent.length > 0);
  const outbound = JSON.parse(leftWire.sent.at(-1));
  check('relay send frame contains ciphertext only', outbound.type === 'send' && !leftWire.sent.at(-1).includes(text));
  rightWire.deliver({ type: 'message', envelope: outbound.envelope, delayedMs: 0 });
  await eventually(() => received !== undefined);
  check('inbound callback labels remote text untrusted', received?.trust === 'untrusted_remote_text');
  check('delivery is not ACKed before the local boundary accepts it', !rightWire.sent.some((raw) => JSON.parse(raw).type === 'ack'));
  releaseLocal();
  await new Promise((resolve) => setImmediate(resolve));
  check('delivery is ACKed after local acceptance', rightWire.sent.some((raw) => JSON.parse(raw).type === 'ack'));
  leftWire.deliver({ type: 'result', requestId: outbound.envelope.requestId, messageId: outbound.envelope.id, status: 'forwarded' });
  check('sender resolves the honest forwarded result', (await sent).status === 'forwarded');

  leftWire.deliver({ type: 'road_update', roadId, revision: 2, status: 'revoked' });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(leftSession.sendRoadText(roadId, 'must stay local'), /road_not_available/);
  checks.push('revoked Roads become unsendable immediately');
  leftWire.deliver({ type: 'road_update', roadId, revision: 1, status: 'active', road: leftRoad });
  await new Promise((resolve) => setImmediate(resolve));
  check('a stale grant cannot resurrect a revoked Road', leftSession.roads().length === 0);

  const failedWire = new MemoryTransport();
  const failedSession = new ManagedRelaySession(right, 'bob/engineering', failedWire, {
    onText: () => { throw new Error('disk_unavailable'); },
  });
  failedWire.deliver({ type: 'welcome', city: 'bob/engineering', deviceId: right.deviceId, protocol: 'agents-city-relay/1', roadCount: 1 });
  failedWire.deliver(directoryFrame('bob/engineering', rightRoad));
  await failedSession.ready();
  failedWire.deliver({ type: 'message', envelope: outbound.envelope, delayedMs: 0 });
  await eventually(() => failedWire.closed.length > 0);
  check('a failed local handoff is not ACKed and remains retryable',
    failedWire.closed.some((entry) => entry.code === 1011)
    && !failedWire.sent.some((raw) => JSON.parse(raw).type === 'ack'));

  const malformed = JSON.stringify({ type: 'pong', at: Date.now(), injected: true });
  check('unknown relay fields are rejected', parseRelayServerFrame(malformed).ok === false);
  rightWire.message(malformed);
  await new Promise((resolve) => setImmediate(resolve));
  check('a malformed relay frame closes with policy violation', rightWire.closed.some((entry) => entry.code === 1008));
  leftSession.close();
  rightSession.close();
}

await rfcVector();
await storageBoundary();
await relayBoundary();
console.log(JSON.stringify({ ok: true, checks: checks.length, names: checks }, null, 2));
