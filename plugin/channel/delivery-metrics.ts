import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { BusEnvelope } from './protocol.js';
import { TerminalReceipt } from './terminal-delivery.js';

export interface DeliveryMetric {
  schema: 'agents-city/delivery-latency@1';
  envelopeId: string;
  thread: string | null;
  kind: string;
  actor: string;
  runtime: string;
  envelopeCreatedAt: string;
  adapterReceivedAt: string;
  terminalReadyAt: string;
  pastedAt: string;
  submittedAt: string;
  transportToAdapterMs: number;
  adapterToSubmitMs: number;
  totalToSubmitMs: number;
  pasteToSubmitMs: number;
  bytes: number;
}

export function recordDelivery(
  runtimeDir: string,
  envelope: BusEnvelope,
  actor: string,
  runtime: string,
  adapterReceivedAt: string,
  receipt: TerminalReceipt,
): DeliveryMetric {
  const metric: DeliveryMetric = {
    schema: 'agents-city/delivery-latency@1',
    envelopeId: envelope.id,
    thread: envelope.thread,
    kind: envelope.kind,
    actor,
    runtime,
    envelopeCreatedAt: envelope.createdAt,
    adapterReceivedAt,
    terminalReadyAt: receipt.readyAt,
    pastedAt: receipt.pastedAt,
    submittedAt: receipt.submittedAt,
    transportToAdapterMs: elapsed(envelope.createdAt, adapterReceivedAt),
    adapterToSubmitMs: elapsed(adapterReceivedAt, receipt.submittedAt),
    totalToSubmitMs: elapsed(envelope.createdAt, receipt.submittedAt),
    pasteToSubmitMs: receipt.pasteToSubmitMs,
    bytes: receipt.bytes,
  };
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  appendFileSync(join(runtimeDir, 'delivery-latency.jsonl'), JSON.stringify(metric) + '\n', {
    mode: 0o600,
  });
  return metric;
}

function elapsed(start: string, end: string): number {
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
