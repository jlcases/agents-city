#!/usr/bin/env node
// Builds the three Workers exactly as wrangler would upload them, into
// dist/<piece>/index.js. `agents-city infra deploy` uploads those files as
// they are, so the computer that deploys needs wrangler and nothing else.

import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const PIECES = {
  control: 'workers/control/wrangler.jsonc',
  relay: 'workers/relay/wrangler.jsonc',
  witness: 'workers/transparency-witness/wrangler.jsonc',
};

for (const [piece, config] of Object.entries(PIECES)) {
  const out = join(ROOT, 'dist', piece);
  rmSync(out, { recursive: true, force: true });
  const built = spawnSync(
    WRANGLER,
    ['deploy', '--dry-run', '--config', join(ROOT, config), '--outdir', out],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
  );
  if (built.status !== 0) {
    console.error(built.stderr || built.stdout);
    process.exit(1);
  }
  // One self-contained module each: anything else would not be uploaded.
  const extra = readdirSync(out).filter((name) => !/^index\.js(\.map)?$|^README\.md$/.test(name));
  if (extra.length) {
    console.error(`${piece}: wrangler emitted more than one module: ${extra.join(', ')}`);
    process.exit(1);
  }
  for (const name of readdirSync(out)) if (name !== 'index.js') rmSync(join(out, name));
  console.log(`${piece}: ${Math.round(statSync(join(out, 'index.js')).size / 1024)} KiB`);
}
