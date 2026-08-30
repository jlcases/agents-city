#!/usr/bin/env node
import { managedConnectCli } from './managed-connect/cli.js';

managedConnectCli().catch((error) => {
  console.error(`agents-city connect: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
