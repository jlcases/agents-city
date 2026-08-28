import { parsePayload } from './cli-args.js';
import { busCommand } from './hub-client.js';

/** Small vendor-neutral entry point used by runtime hooks and diagnostics. */
export async function activityCli(args: string[]): Promise<unknown> {
  const verb = args.shift() || 'help';
  if (['help', '-h', '--help'].includes(verb)) {
    return {
      usage: 'client.js activity publish [thread] --input -',
      note: 'Publishes visible semantic activity; actor identity comes from the bus credential.',
    };
  }
  if (verb !== 'publish') throw new Error(`unknown activity command: ${verb}`);
  const { payload, positional } = parsePayload(args);
  return busCommand('activity.publish', payload, positional[0]);
}
