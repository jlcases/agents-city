import { busCommand } from './hub-client.js';

export async function roadBusCli(args: string[]): Promise<unknown> {
  const verb = args.shift() || 'roster';
  if (['help', '-h', '--help'].includes(verb)) {
    return {
      usage: 'agents-city bus <roster | inbox | send owner/city text>',
      note: 'Only the seat can cross a road. Inbox returns a bounded batch so a burst never becomes one model turn per message.',
    };
  }
  if (verb === 'roster') return busCommand('road.roster');
  if (verb === 'inbox') return busCommand('road.inbox');
  if (verb !== 'send') throw new Error(`unknown bus command: ${verb}`);
  const to = args.shift();
  const text = args.join(' ');
  if (!to || !text) throw new Error('bus send needs a destination and text');
  return busCommand('road.send', { to, text });
}
