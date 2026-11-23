import {
  MAX_SEALED_SUBMISSION_BYTES,
  parseSealedSubmission,
  type SealedSubmission,
} from '../../service-protocol/src/index';

const MAX_RESPONSE_BYTES = 16_384;

const boundedText = async (response: Response, maximumBytes: number) => {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0 || size > maximumBytes) {
      throw new Error('sealed_response_too_large');
    }
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel('response_too_large');
        throw new Error('sealed_response_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
};
export class SealedSenderError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(code);
    this.name = 'SealedSenderError';
  }
}

export const sealedSenderEndpoint = (relayUrl: string) => {
  const url = new URL(relayUrl);
  if (url.protocol === 'wss:') url.protocol = 'https:';
  else if (url.protocol === 'ws:') url.protocol = 'http:';
  else if (!['https:', 'http:'].includes(url.protocol)) throw new Error('invalid_relay_url');
  url.pathname = '/v1/sealed';
  url.search = '';
  url.hash = '';
  return url.toString();
};

export const submitSealedMessage = async (
  endpoint: string,
  candidate: SealedSubmission,
  fetcher: typeof fetch = fetch,
) => {
  const submission = parseSealedSubmission(candidate);
  if (!submission) throw new Error('invalid_sealed_submission');
  const body = JSON.stringify(submission);
  if (new TextEncoder().encode(body).byteLength > MAX_SEALED_SUBMISSION_BYTES) {
    throw new Error('sealed_submission_too_large');
  }
  const response = await fetcher(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  }));
  let value: unknown;
  try {
    value = JSON.parse(await boundedText(response, MAX_RESPONSE_BYTES));
  } catch (error) {
    if (response.ok) throw new SealedSenderError(
      error instanceof Error ? error.message : 'invalid_sealed_response',
      502,
      null,
    );
    value = {};
  }
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new SealedSenderError(
      typeof record.error === 'string' ? record.error : `sealed_sender_${response.status}`,
      response.status,
      Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1_000 : null,
    );
  }
  if (
    Object.keys(record).length !== 2
    || !['queued', 'duplicate'].includes(String(record.status))
    || record.message_id !== submission.id
  ) throw new SealedSenderError('invalid_sealed_response', 502, null);
  return {
    messageId: submission.id,
    status: record.status as 'queued' | 'duplicate',
  };
};
