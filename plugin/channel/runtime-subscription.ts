import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import WebSocket from 'ws';
import { CityContext } from './city-config.js';
import { openActorSocket } from './hub-client.js';
import { BusEnvelope, randomId, safeSegment } from './protocol.js';
import { atomicJson } from './runtime-files.js';
import {
  NativeAcceptance,
  RuntimeDeliveryMetric,
  recordNativeAcceptance,
} from './runtime-metrics.js';

interface RuntimeSubscriptionOptions {
  actor: string;
  context: CityContext;
  label: string;
  deliver: (envelope: BusEnvelope) => Promise<NativeAcceptance>;
  onAccepted?: (metric: RuntimeDeliveryMetric) => void;
  onError?: (error: Error) => void;
}

export interface RuntimeSubscription {
  ready: Promise<void>;
  close: () => void;
}

/**
 * Subscribe one authenticated actor to its durable outbox.
 *
 * Native acceptance is persisted before the bus ACK. If the socket or process
 * dies in that narrow interval, a reconnect ACKs the receipt without invoking
 * the model twice.
 */
export function subscribeRuntime(options: RuntimeSubscriptionOptions): RuntimeSubscription {
  let stopped = false;
  let socket: WebSocket | null = null;
  let tail = Promise.resolve();
  let resolveReady: () => void = () => {};
  let readyResolved = false;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const ackWaiters = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();

  const report = (error: unknown): void => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (options.onError) options.onError(normalized);
    else console.error(`[${options.label}] ${normalized.message}`);
  };

  const connect = async (): Promise<void> => {
    if (stopped) return;
    try {
      const opened = await openActorSocket('runtime', options.actor, options.context, (raw) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (message.type === 'result') {
          const waiter = ackWaiters.get(String(message.requestId || ''));
          if (!waiter) return;
          clearTimeout(waiter.timer);
          ackWaiters.delete(String(message.requestId || ''));
          if (message.ok) waiter.resolve();
          else waiter.reject(new Error(String(message.error || 'bus acknowledgement failed')));
          return;
        }
        if (message.type !== 'envelope') return;
        const envelope = message.envelope as BusEnvelope;
        const receivedAt = new Date().toISOString();
        tail = tail.then(() => accept(envelope, receivedAt)).catch(report);
      });
      socket = opened.ws;
      if (!readyResolved) {
        readyResolved = true;
        resolveReady();
      }
      socket.on('close', () => {
        socket = null;
        rejectAcks(new Error('city bus disconnected before acknowledgement'));
        if (!stopped) setTimeout(() => void connect(), 500);
      });
      socket.on('error', () => {});
    } catch (error) {
      report(error);
      if (!stopped) setTimeout(() => void connect(), 500);
    }
  };

  const accept = async (envelope: BusEnvelope, receivedAt: string): Promise<void> => {
    const marker = receiptPath(options.context, options.actor, envelope.id);
    let acceptance = readReceipt(marker, envelope.id);
    if (!acceptance) {
      acceptance = await options.deliver(envelope);
      atomicJson(marker, { envelopeId: envelope.id, acceptance });
      const metric = recordNativeAcceptance(
        options.context.runtimeDir,
        envelope,
        options.actor,
        receivedAt,
        acceptance,
      );
      options.onAccepted?.(metric);
    }
    await acknowledge(envelope.id);
    try {
      unlinkSync(marker);
    } catch {}
  };

  const acknowledge = (envelopeId: string): Promise<void> => {
    const current = socket;
    if (!current || current.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('city bus is offline; native receipt retained for retry'));
    }
    const requestId = randomId('ack');
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ackWaiters.delete(requestId);
        reject(new Error('city bus acknowledgement timed out'));
      }, 5_000);
      ackWaiters.set(requestId, { resolve, reject, timer });
      current.send(JSON.stringify({ type: 'ack', requestId, envelopeId }), (error) => {
        if (!error) return;
        const waiter = ackWaiters.get(requestId);
        if (!waiter) return;
        clearTimeout(waiter.timer);
        ackWaiters.delete(requestId);
        waiter.reject(error);
      });
    });
  };

  const rejectAcks = (error: Error): void => {
    for (const [requestId, waiter] of ackWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
      ackWaiters.delete(requestId);
    }
  };

  void connect();
  return {
    ready,
    close: () => {
      stopped = true;
      rejectAcks(new Error('runtime subscription stopped'));
      try {
        socket?.close();
      } catch {}
    },
  };
}

function receiptPath(context: CityContext, actor: string, envelopeId: string): string {
  const directory = join(context.runtimeDir, 'accepted', safeSegment(actor));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return join(directory, `${safeSegment(envelopeId, 'message')}.json`);
}

function readReceipt(path: string, envelopeId: string): NativeAcceptance | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      envelopeId?: string;
      acceptance?: NativeAcceptance;
    };
    return parsed.envelopeId === envelopeId && parsed.acceptance?.acceptedAt
      ? parsed.acceptance
      : null;
  } catch {
    return null;
  }
}
