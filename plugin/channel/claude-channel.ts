import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { join } from 'path';
import { promptFor } from './adapter-prompts.js';
import { CityContext } from './city-config.js';
import { BusEnvelope, safeSegment } from './protocol.js';
import { atomicJson } from './runtime-files.js';
import { RuntimeSubscription, subscribeRuntime } from './runtime-subscription.js';

/** Deliver city envelopes through Claude Code's native Channel notification. */
export function startClaudeChannel(
  server: Server,
  context: CityContext,
  actor: string,
): RuntimeSubscription {
  return subscribeRuntime({
    actor,
    context,
    label: `city-channel:${actor}`,
    deliver: async (envelope: BusEnvelope) => {
      const operatingRole = context.actors[actor]?.operatingRole || 'blank';
      // Claude's Stop hook runs in a separate process. Leave it only the
      // semantic city thread so the visible answer joins the committee
      // conversation instead of being stranded under a provider session id.
      atomicJson(join(context.runtimeDir, 'claude-threads', `${safeSegment(actor)}.json`), {
        thread: envelope.thread || envelope.id,
        envelopeId: envelope.id,
        kind: envelope.kind,
        at: new Date().toISOString(),
      });
      await server.notification({
        method: 'notifications/claude/channel',
        params: {
          content: promptFor(envelope, operatingRole),
          meta: {
            protocol: envelope.protocol,
            envelope_id: envelope.id,
            city: context.city.address,
            actor,
            kind: envelope.kind,
            thread: envelope.thread || '',
          },
        },
      } as never);
      return {
        acceptedAt: new Date().toISOString(),
        runtime: 'claude',
        transport: 'mcp-channel',
        providerRequestId: envelope.id,
      };
    },
    onAccepted: (metric) => {
      console.error(
        `[city-channel:${actor}] accepted ${metric.envelopeId} in ` +
          `${metric.totalToNativeAcceptMs}ms via Claude Channel`,
      );
    },
  });
}
