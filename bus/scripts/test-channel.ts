/** Compatibility entrypoint for the canonical local-channel integration test. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const test = fileURLToPath(new URL('../../bin/test-channel.py', import.meta.url));
const result = spawnSync(test, { stdio: 'inherit' });

process.exit(result.status ?? 1);
