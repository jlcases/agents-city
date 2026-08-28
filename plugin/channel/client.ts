#!/usr/bin/env node
import { committeeCli } from './committee-cli.js';
import { activityCli } from './activity-cli.js';
import { loadCityContext } from './city-config.js';
import { ensureHub } from './hub-client.js';
import { roadBusCli } from './road-cli.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const domain = args.shift() || 'help';
  let value: unknown;
  if (domain === 'committee') value = await committeeCli(args);
  else if (domain === 'activity') value = await activityCli(args);
  else if (domain === 'bus') value = await roadBusCli(args);
  else if (domain === 'ensure') {
    const endpoint = await ensureHub(loadCityContext());
    value = {
      protocol: endpoint.protocol,
      city: endpoint.cityAddress,
      url: endpoint.url,
      pid: endpoint.pid,
    };
  } else if (domain === 'runtime-dir') {
    value = loadCityContext().runtimeDir;
  } else {
    value = {
      usage: 'client.js <ensure | runtime-dir | bus | committee | activity>',
      note: 'This is the vendor-neutral WebSocket client behind the agents-city commands.',
    };
  }
  if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

main().catch((error) => {
  console.error(`agents-city: ${(error as Error).message}`);
  process.exit(1);
});
