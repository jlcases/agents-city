import {
  canonicalRelayEnvelope,
  parseKeyTransparencyQuery,
  parseRelayClientFrame,
  parseSealedDelivery,
  parseSealedSubmission,
  parseSignedHybridPrekey,
} from '../../packages/service-protocol/src/index';

export function fuzz(data: Uint8Array) {
  const raw = new TextDecoder().decode(data);
  const frame = parseRelayClientFrame(raw);
  if (frame.ok && frame.frame.type === 'send') {
    canonicalRelayEnvelope(frame.frame.envelope);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return;
  }

  parseSealedSubmission(value);
  parseSealedDelivery(value);
  parseSignedHybridPrekey(value);
  try {
    parseKeyTransparencyQuery(value);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('invalid_')) {
      throw error;
    }
  }
}
