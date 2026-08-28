import { ActorRole, BUS_PROTOCOL, BusEnvelope, isoNow, randomId, text } from '../protocol.js';
import { CityContext } from '../city-config.js';
import { recordRoadInbox, takeRoadInbox } from '../delivery-queue.js';
import { requireChair } from '../committee/guards.js';
import { wrapUntrusted } from '../untrusted.js';
import { EnvelopeRouter } from './envelopes.js';
import { localRoadOnline, sendLocalRoad } from './local-roads.js';
import { remoteRoadBridge } from './remote-roads.js';

export function roadController(context: CityContext, router: EnvelopeRouter) {
  const inbound = (envelope: BusEnvelope): void => {
    const road = context.roads.find((candidate) => candidate.address === envelope.from.city);
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
    recordRoadInbox(context.runtimeDir, guarded);
    router.roadInbound(guarded);
  };
  const remote = remoteRoadBridge(context, (envelope) => {
    try {
      inbound(envelope);
    } catch (error) {
      console.error(`[city-bus] dropped remote envelope: ${(error as Error).message}`);
    }
  });

  const sendOne = async (to: string, body: string): Promise<string> => {
    const road = context.roads.find((candidate) => candidate.address === to);
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
      return context.roads.map((road) => ({
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
    if (!context.roads.length) throw new Error('this city has no roads');
    const results: string[] = [];
    for (const road of context.roads) results.push(await sendOne(road.address, body));
    return { results };
  };

  return { command, inbound, start: remote.start, close: remote.close };
}

export type RoadController = ReturnType<typeof roadController>;
