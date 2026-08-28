import { textDecoder, textEncoder, utf8Length } from './encoding.js';
import { UUID_RE } from './protocol.js';

export const PERSON_MESSAGE_PROTOCOL = 'agents-city-person-message/1' as const;
const MAX_PERSON_TEXT_BYTES = 11_500;

export type PersonMessage = {
  kind: 'message' | 'rejection';
  text: string;
  inReplyTo: string | null;
};

export function encodePersonMessage(message: PersonMessage): string {
  validateText(message.text);
  if (!['message', 'rejection'].includes(message.kind)) {
    throw new Error('invalid_person_message_kind');
  }
  if (message.inReplyTo !== null && !UUID_RE.test(message.inReplyTo)) {
    throw new Error('invalid_person_reply_reference');
  }
  return textDecoder.decode(
    textEncoder.encode(
      JSON.stringify({
        protocol: PERSON_MESSAGE_PROTOCOL,
        kind: message.kind,
        text: message.text,
        ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
      }),
    ),
  );
}

/**
 * A legacy or deliberately malformed application frame is still harmless
 * untrusted text. Keep it visible to the human instead of creating an
 * unacknowledgeable poison message that the relay would retry forever.
 */
export function decodePersonMessage(value: string): PersonMessage {
  validateText(value);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { kind: 'message', text: value, inReplyTo: null };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'message', text: value, inReplyTo: null };
  }
  const record = parsed as Record<string, unknown>;
  const allowed = new Set(['protocol', 'kind', 'text', 'inReplyTo']);
  if (
    record.protocol !== PERSON_MESSAGE_PROTOCOL ||
    !['message', 'rejection'].includes(String(record.kind)) ||
    typeof record.text !== 'string' ||
    !record.text.trim() ||
    utf8Length(record.text) > MAX_PERSON_TEXT_BYTES ||
    (record.inReplyTo !== undefined &&
      (typeof record.inReplyTo !== 'string' || !UUID_RE.test(record.inReplyTo))) ||
    Object.keys(record).some((key) => !allowed.has(key))
  ) {
    return { kind: 'message', text: value, inReplyTo: null };
  }
  return {
    kind: record.kind as PersonMessage['kind'],
    text: record.text,
    inReplyTo: typeof record.inReplyTo === 'string' ? record.inReplyTo : null,
  };
}

function validateText(value: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error('person_message_required');
  if (utf8Length(value) > MAX_PERSON_TEXT_BYTES) throw new Error('person_message_too_large');
}
