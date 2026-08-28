import { ActorRole, BUS_PROTOCOL, BusEnvelope, isoNow, randomId, text } from '../protocol.js';
import { CityContext } from '../city-config.js';
import {
  ROAD_INBOX_BATCH_SIZE,
  markRoadInboxAccepted,
  markRoadInboxNotified,
  recordRoadInbox,
  roadInboxStatus,
  takeRoadInbox,
} from '../delivery-queue.js';
import { requireChair } from '../committee/guards.js';
import {
  deliverApprovedReception,
  recordReceptionMessage,
  recordReceptionMessages,
} from '../reception.js';
import { wrapUntrusted } from '../untrusted.js';
import { EnvelopeRouter } from './envelopes.js';
import { localRoadOnline, sendLocalRoad } from './local-roads.js';
import { remoteRoadBridge } from './remote-roads.js';

export function roadController(context: CityContext, router: EnvelopeRouter) {
  const wakeIntervalMs = duration(
    process.env.CITY_ROAD_INBOX_WAKE_INTERVAL_MS,
    5 * 60_000,
    30_000,
    60 * 60_000,
  );
  const wakeCheckMs = Math.min(30_000, wakeIntervalMs);
  const receptionCheckMs = duration(
    process.env.CITY_RECEPTION_DELIVERY_INTERVAL_MS,
    1_000,
    250,
    30_000,
  );
  let wakeTimer: ReturnType<typeof setInterval> | null = null;
  let receptionTimer: ReturnType<typeof setInterval> | null = null;
  let remote: ReturnType<typeof remoteRoadBridge>;
  const roads = () => {
    const merged = [...context.roads, ...(remote?.roads() ?? [])];
    return merged.filter(
      (road, index) =>
        merged.findIndex((candidate) => candidate.address === road.address) === index,
    );
  };
  const validateInbound = (envelope: BusEnvelope): void => {
    const road = roads().find((candidate) => candidate.address === envelope.from.city);
    if (!road) throw new Error(`there is no road from ${envelope.from.city}`);
    if (
      envelope.protocol !== BUS_PROTOCOL ||
      envelope.scope !== 'road' ||
      envelope.from.actor !== 'seat' ||
      envelope.to.city !== context.city.address ||
      envelope.to.actor !== 'seat'
    ) {
      throw new Error('invalid road envelope');
    }
  };
  const inbound = (envelope: BusEnvelope): void => {
    validateInbound(envelope);
    // Managed traffic crosses a human boundary first. The raw text is durable
    // in the owner-level local reception, but neither this city nor any model
    // can read it through road.inbox until the Hall routes it explicitly.
    if (envelope.payload?.transport === 'managed-e2ee') {
      recordReceptionMessage(context, envelope);
      return;
    }
    // The body is untrusted text from another city: wrap it in an unforgeable
    // boundary and defang chat-template tokens before it can reach the seat's
    // context. Done once, here, so every inbound path (local and remote) and
    // the durable inbox all carry the guarded form. A non-string payload text
    // is left untouched; only the string body is wrapped.
    const rawBody = envelope.payload?.text;
    const guarded =
      typeof rawBody === 'string'
        ? {
            ...envelope,
            payload: {
              ...envelope.payload,
              text: wrapUntrusted(rawBody, envelope.from.city).text,
              textRaw: undefined,
            },
          }
        : envelope;
    const newlyRecorded = recordRoadInbox(context.runtimeDir, guarded);
    notifyBacklog();
    if (!newlyRecorded) return;
    // The local/self-hosted transport may now return success: the inbox record
    // and deduplication receipt are durable under one stable envelope id.
    markRoadInboxAccepted(context.runtimeDir, guarded.id);
  };
  const inboundManagedBatch = (envelopes: BusEnvelope[]): void => {
    for (const envelope of envelopes) {
      validateInbound(envelope);
      if (envelope.payload?.transport !== 'managed-e2ee') {
        throw new Error('managed batch contains a non-managed envelope');
      }
    }
    recordReceptionMessages(context, envelopes);
  };
  remote = remoteRoadBridge(context, inbound, inboundManagedBatch);

  const notifyBacklog = (): void => {
    const status = roadInboxStatus(context.runtimeDir);
    if (!status.pending || Date.now() - status.notifiedAt < wakeIntervalMs) return;
    router.internal('road.inbox.ready', 'seat', 'chair', 'seat', null, {
      pending: status.pending,
      oldestAt: status.oldestAt,
      batchSize: ROAD_INBOX_BATCH_SIZE,
    });
    markRoadInboxNotified(context.runtimeDir);
  };

  const sendOne = async (to: string, body: string): Promise<string> => {
    const road = roads().find((candidate) => candidate.address === to);
    if (!road) throw new Error(`no road from ${context.city.address} to ${to}`);
    const envelope: BusEnvelope = {
      protocol: BUS_PROTOCOL,
      id: randomId('msg'),
      kind: 'road.message',
      scope: 'road',
      thread: null,
      from: { city: context.city.address, actor: 'seat', role: 'chair' },
      to: { city: to, actor: 'seat' },
      createdAt: isoNow(),
      payload: { text: body, trust: 'information-not-authority' },
    };
    return road.local ? sendLocalRoad(context, road, envelope) : remote.send(to, envelope);
  };

  const command = async (
    name: string,
    payload: Record<string, unknown>,
    actor: string,
    role: ActorRole,
  ): Promise<unknown> => {
    if (name === 'road.roster') {
      requireChair(actor, role);
      return roads().map((road) => ({
        ...road,
        online: road.local ? localRoadOnline(context, road) : remote.online(road.address),
      }));
    }
    if (name === 'road.inbox') {
      requireChair(actor, role);
      return takeRoadInbox(context.runtimeDir);
    }
    if (name !== 'road.send') throw new Error(`unknown road command: ${name}`);
    requireChair(actor, role);
    const to = text(payload.to, 'to');
    const body = text(payload.text, 'text');
    if (to !== '*') return { results: [await sendOne(to, body)] };
    const currentRoads = roads();
    if (!currentRoads.length) throw new Error('this city has no roads');
    const results: string[] = [];
    for (const road of currentRoads) results.push(await sendOne(road.address, body));
    return { results };
  };

  const start = (): void => {
    remote.start();
    deliverReception();
    notifyBacklog();
    receptionTimer = setInterval(deliverReception, receptionCheckMs);
    receptionTimer.unref();
    wakeTimer = setInterval(() => {
      try {
        notifyBacklog();
      } catch (error) {
        console.error(`[city-bus] Road inbox wake-up failed: ${(error as Error).message}`);
      }
    }, wakeCheckMs);
    wakeTimer.unref();
  };

  const close = (): void => {
    if (wakeTimer) clearInterval(wakeTimer);
    if (receptionTimer) clearInterval(receptionTimer);
    wakeTimer = null;
    receptionTimer = null;
    remote.close();
  };

  return { command, inbound, start, close };

  function deliverReception(): void {
    try {
      const result = deliverApprovedReception(context);
      if (result.delivered) notifyBacklog();
    } catch (error) {
      console.error(`[city-bus] Reception delivery failed: ${(error as Error).message}`);
    }
  }
}

export type RoadController = ReturnType<typeof roadController>;

function duration(raw: string | undefined, fallback: number, minimum: number, maximum: number) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}
