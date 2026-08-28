import { ActorRole, BUS_PROTOCOL, BusEnvelope, isoNow, randomId } from '../protocol.js';
import { CityContext } from '../city-config.js';
import { acknowledge, enqueueForActor, pendingForActor } from '../delivery-queue.js';
import { ConnectionRegistry } from './connections.js';

interface EnvelopeRouterOptions {
  staleReason?: (envelope: BusEnvelope) => string;
  onDrop?: (envelope: BusEnvelope, reason: string) => void;
}

export function envelopeRouter(
  context: CityContext,
  connections: ConnectionRegistry,
  options: EnvelopeRouterOptions = {},
) {
  const internal = (
    kind: string,
    fromActor: string,
    fromRole: ActorRole,
    toActor: string,
    thread: string | null,
    payload: Record<string, unknown>,
  ): BusEnvelope => {
    const envelope: BusEnvelope = {
      protocol: BUS_PROTOCOL,
      id: randomId('msg'),
      kind,
      scope: 'internal',
      thread,
      from: { city: context.city.address, actor: fromActor, role: fromRole },
      to: { city: context.city.address, actor: toActor },
      createdAt: isoNow(),
      payload,
    };
    enqueueForActor(context.runtimeDir, envelope);
    connections.deliver(toActor, envelope);
    return envelope;
  };

  const roadInbound = (envelope: BusEnvelope): void => {
    enqueueForActor(context.runtimeDir, envelope);
    connections.deliver('seat', envelope);
  };

  const drain = (actor: string): number => {
    const pending = pendingForActor(context.runtimeDir, actor);
    let delivered = 0;
    for (const envelope of pending) {
      const reason = options.staleReason?.(envelope) || '';
      if (reason) {
        acknowledge(context.runtimeDir, actor, envelope.id);
        options.onDrop?.(envelope, reason);
        continue;
      }
      if (connections.deliver(actor, envelope)) delivered += 1;
    }
    return delivered;
  };

  const ack = (actor: string, envelopeId: string): boolean =>
    acknowledge(context.runtimeDir, actor, envelopeId);

  return { internal, roadInbound, drain, ack };
}

export type EnvelopeRouter = ReturnType<typeof envelopeRouter>;
