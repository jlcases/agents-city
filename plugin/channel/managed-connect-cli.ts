#!/usr/bin/env node
import { managedConnectCli } from './managed-connect/cli.js';
import { explainOrganizationError } from './managed-connect/orgs.js';

// The same program answers four commands; an error names the one that was run.
const door = ['auth', 'orgs', 'infra'].includes(process.argv[2] ?? '')
  ? process.argv[2]
  : 'connect';

managedConnectCli().catch((error) => {
  // Organization wording only for organization commands: the same code from
  // another endpoint means something else.
  const said =
    door === 'orgs'
      ? explainOrganizationError(error)
      : error instanceof Error
        ? error.message
        : String(error);
  console.error(`agents-city ${door}: ${said}`);
  process.exitCode = 1;
});
