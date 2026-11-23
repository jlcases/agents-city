import { describe, expect, it } from 'vitest';
import {
  HYBRID_ESTABLISHMENT_SUITE,
  HYBRID_PREKEY_PROTOCOL,
  MAX_FRAME_BYTES,
  RELAY_PROTOCOL,
  SEALED_SENDER_PROTOCOL,
  SEALED_SUITE,
  parseKeyTransparencyQuery,
  parseRelayClientFrame,
  parseSealedSubmission,
  parseSignedHybridPrekey,
} from '../../service-protocol/src/index';

const NOW = 1_800_000_000_000;
const UUID = '018f3f71-d19d-7d4b-8b87-b6773120c531';
const OTHER_UUID = '118f3f71-d19d-7d4b-8b87-b6773120c532';
const b64url = (decodedBytes: number) => 'A'.repeat(Math.ceil(decodedBytes * 4 / 3));
const standardB64 = (decodedBytes: number) => {
  let binary = '';
  for (let index = 0; index < decodedBytes; index += 1) binary += String.fromCharCode(0);
  return btoa(binary);
};

const validEnvelope = () => ({
  protocol: RELAY_PROTOCOL,
  id: UUID,
  requestId: OTHER_UUID,
  roadId: '218f3f71-d19d-7d4b-8b87-b6773120c533',
  roadRevision: 1,
  from: 'alice/city',
  to: 'bob/city',
  createdAt: NOW,
  expiresAt: NOW + 60_000,
  senderDeviceId: '318f3f71-d19d-7d4b-8b87-b6773120c534',
  senderKeyVersion: 1,
  payload: {
    suite: SEALED_SUITE,
    recipientKeyId: b64url(32),
    messageType: 1,
    ciphertext: standardB64(32),
  },
  signature: b64url(64),
});

const clone = <T>(value: T): T => structuredClone(value);

const targetedInvalidFrames = () => {
  const frames: unknown[] = [];
  const withUnknownRoot = { type: 'send', envelope: validEnvelope(), debug: true };
  frames.push(withUnknownRoot);

  const unknownEnvelope = validEnvelope() as ReturnType<typeof validEnvelope> & { debug?: boolean };
  unknownEnvelope.debug = true;
  frames.push({ type: 'send', envelope: unknownEnvelope });

  const unknownPayload = validEnvelope();
  Object.assign(unknownPayload.payload, { plaintext: 'secret' });
  frames.push({ type: 'send', envelope: unknownPayload });

  for (const mutation of [
    (value: ReturnType<typeof validEnvelope>) => { value.protocol = 'agents-city-relay/3' as typeof RELAY_PROTOCOL; },
    (value: ReturnType<typeof validEnvelope>) => { value.roadRevision = 0; },
    (value: ReturnType<typeof validEnvelope>) => { value.from = value.to; },
    (value: ReturnType<typeof validEnvelope>) => { value.expiresAt = value.createdAt; },
    (value: ReturnType<typeof validEnvelope>) => { value.senderKeyVersion = 0; },
    (value: ReturnType<typeof validEnvelope>) => { value.payload.messageType = 2 as 1; },
    (value: ReturnType<typeof validEnvelope>) => { value.payload.recipientKeyId = b64url(31); },
    (value: ReturnType<typeof validEnvelope>) => { value.payload.ciphertext = standardB64(16); },
    (value: ReturnType<typeof validEnvelope>) => { value.signature = b64url(63); },
  ]) {
    const envelope = clone(validEnvelope());
    mutation(envelope);
    frames.push({ type: 'send', envelope });
  }

  const fakeHybrid = clone(validEnvelope()) as Record<string, unknown>;
  fakeHybrid.payload = {
    ...(fakeHybrid.payload as Record<string, unknown>),
    suite: HYBRID_ESTABLISHMENT_SUITE,
  };
  frames.push({ type: 'send', envelope: fakeHybrid });
  frames.push({ type: 'ping', at: '0' }, { type: 'ping', at: -1 }, { type: 'ping', at: 1.5 });
  return frames;
};

const mutate = (source: string, iteration: number) => {
  let state = (iteration + 1) * 0x9e3779b1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const bytes = Array.from(source);
  const count = 1 + (next() % 5);
  for (let change = 0; change < count; change += 1) {
    const index = next() % Math.max(1, bytes.length);
    switch (next() % 4) {
      case 0:
        bytes[index] = String.fromCharCode(32 + (next() % 95));
        break;
      case 1:
        bytes.splice(index, 1);
        break;
      case 2:
        bytes.splice(index, 0, String.fromCharCode(32 + (next() % 95)));
        break;
      default:
        bytes.splice(index, next() % Math.min(32, bytes.length - index + 1));
    }
  }
  return bytes.join('');
};

describe('untrusted protocol mutation corpus', () => {
  it('rejects schema extensions, downgrade shapes, invalid clocks, and ambiguous ping values', () => {
    expect(parseRelayClientFrame(JSON.stringify({ type: 'ping' }), NOW)).toEqual({
      ok: true,
      frame: { type: 'ping', at: undefined },
    });
    expect(parseRelayClientFrame(JSON.stringify({ type: 'ping', at: NOW }), NOW).ok).toBe(true);
    for (const frame of targetedInvalidFrames()) {
      expect(parseRelayClientFrame(JSON.stringify(frame), NOW).ok).toBe(false);
    }
  });

  it('handles ten thousand deterministic byte-level mutations without an uncaught parser error', () => {
    const seed = JSON.stringify({ type: 'send', envelope: validEnvelope() });
    let rejected = 0;
    for (let iteration = 0; iteration < 10_000; iteration += 1) {
      const result = parseRelayClientFrame(mutate(seed, iteration), NOW);
      if (!result.ok) rejected += 1;
    }
    expect(rejected).toBeGreaterThan(9_000);
    expect(parseRelayClientFrame(seed + ' '.repeat(MAX_FRAME_BYTES), NOW)).toEqual({
      ok: false,
      code: 'frame_too_large',
    });
  });

  it('keeps sealed, hybrid-prekey, and transparency decoders total over hostile JSON values', () => {
    const validSealed = {
      protocol: SEALED_SENDER_PROTOCOL,
      id: UUID,
      capability: b64url(32),
      payload: {
        suite: SEALED_SUITE,
        messageType: 1,
        ciphertext: standardB64(32),
      },
    };
    const validHybridPrekey = {
      record: {
        protocol: HYBRID_PREKEY_PROTOCOL,
        suite: HYBRID_ESTABLISHMENT_SUITE,
        keyId: 'prekey_0123456789abcdef',
        publicKey: b64url(1_184),
        signingKeyId: b64url(32),
        keyVersion: 1,
      },
      signature: b64url(64),
    };
    expect(parseSealedSubmission(validSealed)).not.toBeNull();
    expect(parseSignedHybridPrekey(validHybridPrekey)).not.toBeNull();

    const seeds = [
      JSON.stringify(validSealed),
      JSON.stringify(validHybridPrekey),
      JSON.stringify({ protocol: 'agents-city-key-transparency/1' }),
      'null',
      '[]',
      '{}',
    ];
    let transparencyRejected = 0;
    for (let iteration = 0; iteration < 5_000; iteration += 1) {
      const raw = mutate(seeds[iteration % seeds.length]!, iteration);
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        continue;
      }
      expect(() => parseSealedSubmission(value)).not.toThrow();
      expect(() => parseSignedHybridPrekey(value)).not.toThrow();
      try {
        parseKeyTransparencyQuery(value);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/^invalid_/);
        transparencyRejected += 1;
      }
    }
    expect(transparencyRejected).toBeGreaterThan(100);
  });
});
