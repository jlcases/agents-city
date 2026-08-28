import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { BusEnvelope } from './protocol.js';

export interface NativeAcceptance {
  acceptedAt: string;
  runtime: string;
  transport: string;
  providerRequestId?: string;
}

export interface RuntimeDeliveryMetric extends NativeAcceptance {
  protocol: 'agents-city-runtime-delivery/1';
  envelopeId: string;
  thread: string | null;
  actor: string;
  createdAt: string;
  gatewayReceivedAt: string;
  busToGatewayMs: number;
  gatewayToNativeAcceptMs: number;
  totalToNativeAcceptMs: number;
}

export function recordNativeAcceptance(
  runtimeDir: string,
  envelope: BusEnvelope,
  actor: string,
  gatewayReceivedAt: string,
  acceptance: NativeAcceptance,
): RuntimeDeliveryMetric {
  const metric: RuntimeDeliveryMetric = {
    protocol: 'agents-city-runtime-delivery/1',
    envelopeId: envelope.id,
    thread: envelope.thread,
    actor,
    createdAt: envelope.createdAt,
    gatewayReceivedAt,
    ...acceptance,
    busToGatewayMs: elapsed(envelope.createdAt, gatewayReceivedAt),
    gatewayToNativeAcceptMs: elapsed(gatewayReceivedAt, acceptance.acceptedAt),
    totalToNativeAcceptMs: elapsed(envelope.createdAt, acceptance.acceptedAt),
  };
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  appendFileSync(join(runtimeDir, 'runtime-latency.jsonl'), JSON.stringify(metric) + '\n', {
    mode: 0o600,
  });
  return metric;
}

function elapsed(start: string, end: string): number {
  return Math.max(0, Date.parse(end) - Date.parse(start));
}
