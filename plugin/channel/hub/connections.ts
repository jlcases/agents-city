import WebSocket from 'ws';
import { ActorRole, BusEnvelope } from '../protocol.js';

export type ClientMode = 'runtime' | 'adapter' | 'client' | 'mcp';

export interface ActorPeer {
  ws: WebSocket;
  actor: string;
  role: ActorRole;
  mode: ClientMode;
}

export function connectionRegistry() {
  const peers = new Set<ActorPeer>();

  const add = (peer: ActorPeer): void => {
    peers.add(peer);
  };
  const remove = (ws: WebSocket): void => {
    for (const peer of peers) if (peer.ws === ws) peers.delete(peer);
  };
  const deliver = (actor: string, envelope: BusEnvelope): boolean => {
    // A native runtime gateway owns delivery. The terminal adapter is retained
    // only as an explicit compatibility fallback, and is never used while a
    // native gateway for the actor is online. CLI/MCP command connections cannot
    // consume an envelope merely by opening a status command.
    const candidates = [...peers].filter(
      (candidate) => candidate.actor === actor && candidate.ws.readyState === WebSocket.OPEN,
    );
    const peer =
      candidates.find((candidate) => candidate.mode === 'runtime') ||
      candidates.find((candidate) => candidate.mode === 'adapter');
    if (!peer) return false;
    peer.ws.send(JSON.stringify({ type: 'envelope', envelope }));
    return true;
  };
  const online = (actor: string): boolean =>
    [...peers].some(
      (peer) =>
        peer.actor === actor &&
        (peer.mode === 'runtime' || peer.mode === 'adapter') &&
        peer.ws.readyState === WebSocket.OPEN,
    );

  return { add, remove, deliver, online };
}

export type ConnectionRegistry = ReturnType<typeof connectionRegistry>;
