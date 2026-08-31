import { readFileSync } from 'fs';
import { join } from 'path';
import WebSocket from 'ws';
import { limpia as limpiaRemite } from './lo-que-te-llega.js';
import { CityContext, runtimeDirForCity } from '../city-config.js';
import { queueRoad } from '../delivery-queue.js';
import { BusEnvelope, HubEndpoint, Road, randomId } from '../protocol.js';

export async function sendLocalRoad(
  context: CityContext,
  road: Road,
  envelope: BusEnvelope,
): Promise<string> {
  const destinationRuntime = runtimeDirForCity(context.appHome, road.id);
  let endpoint: HubEndpoint;
  try {
    endpoint = JSON.parse(
      readFileSync(join(destinationRuntime, 'endpoint.json'), 'utf8'),
    ) as HubEndpoint;
    if (endpoint.cityId !== road.id || endpoint.cityAddress !== road.address)
      throw new Error('identity mismatch');
  } catch {
    queueRoad(destinationRuntime, envelope);
    return `${road.address} is offline: queued on the local bus`;
  }
  try {
    return await deliver(endpoint, context.city.address, envelope);
  } catch {
    queueRoad(destinationRuntime, envelope);
    return `${road.address} became unavailable: queued on the local bus`;
  }
}

/**
 * What the city at the far end says it is, read from its own endpoint file.
 *
 * The same file `localRoadOnline` already trusts to decide the city is alive.
 * Nothing new is trusted here: if that file is good enough to say "this city
 * exists and is running", it is good enough to say "and it is the design one".
 */
export function localRoadPresenta(
  context: CityContext,
  road: Road,
): { domain: string; seatRole: string; recibe: string } | null {
  try {
    const endpoint = JSON.parse(
      readFileSync(join(runtimeDirForCity(context.appHome, road.id), 'endpoint.json'), 'utf8'),
    ) as HubEndpoint;
    if (endpoint.cityId !== road.id || endpoint.cityAddress !== road.address) return null;
    const dicho = endpoint.presenta;
    if (!dicho || typeof dicho.seatRole !== 'string' || typeof dicho.domain !== 'string')
      return null;
    // Untrusted text from another process: bounded and shaped before it is
    // handed to anybody who might put it in a prompt.
    const limpio = (valor: string): string =>
      /^[a-z0-9-]{1,80}$/.test(valor.trim().toLowerCase()) ? valor.trim().toLowerCase() : '';
    const seatRole = limpio(dicho.seatRole);
    const domain = limpio(dicho.domain);
    // Bounded again on the way in. The publisher bounds it too, and that is
    // the point: the writer is another process, and a reader that trusts a
    // length because the writer promised one is trusting the wrong side.
    const recibe = limpiaRemite(typeof dicho.recibe === 'string' ? dicho.recibe : '');
    return seatRole || domain ? { domain, seatRole, recibe } : null;
  } catch {
    return null;
  }
}

export function localRoadOnline(context: CityContext, road: Road): boolean {
  try {
    const endpoint = JSON.parse(
      readFileSync(join(runtimeDirForCity(context.appHome, road.id), 'endpoint.json'), 'utf8'),
    ) as HubEndpoint;
    if (endpoint.cityId !== road.id || endpoint.cityAddress !== road.address || endpoint.pid <= 0)
      return false;
    process.kill(endpoint.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function deliver(endpoint: HubEndpoint, from: string, envelope: BusEnvelope): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint.url);
    url.searchParams.set('mode', 'road');
    url.searchParams.set('from', from);
    url.searchParams.set('token', endpoint.roadToken);
    const ws = new WebSocket(url);
    const requestId = randomId('request');
    const timer = setTimeout(() => finish(new Error('local road timed out')), 5_000);
    let sent = false;
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      if (error) reject(error);
      else resolve(`delivered locally to ${endpoint.cityAddress}`);
    };
    ws.on('message', (raw) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (message.type === 'welcome' && !sent) {
        sent = true;
        ws.send(JSON.stringify({ type: 'road.ingress', requestId, envelope }));
      } else if (message.type === 'result' && message.requestId === requestId) {
        if (message.ok) finish();
        else finish(new Error(String(message.error || 'local road refused the message')));
      }
    });
    ws.on('error', () => finish(new Error('local road connection failed')));
    ws.on('close', () => {
      if (!sent) finish(new Error('local road closed before delivery'));
    });
  });
}
