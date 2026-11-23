#!/usr/bin/env node
import { managedConnectCli } from './managed-connect/cli.js';
import { explainOrganizationError } from './managed-connect/orgs.js';

// The same program answers three commands; an error names the one that was run.
const door = ['auth', 'orgs'].includes(process.argv[2] ?? '') ? process.argv[2] : 'connect';

managedConnectCli().catch((error) => {
  console.error(`agents-city ${door}: ${explainOrganizationError(error)}`);
  process.exitCode = 1;
});
