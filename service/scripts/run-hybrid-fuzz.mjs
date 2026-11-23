import { delimiter, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const mode = process.argv[2];
if (!['--check', '--run'].includes(mode)) {
  console.error('usage: node scripts/run-hybrid-fuzz.mjs --check|--run');
  process.exit(2);
}

const toolchain = process.env.RUST_NIGHTLY ?? 'nightly-2026-08-28';
const durationSeconds = Number(process.env.AGENTS_CITY_FUZZ_SECONDS ?? 60);
if (
  !Number.isSafeInteger(durationSeconds)
  || durationSeconds < 1
  || durationSeconds > 3_600
) {
  console.error('AGENTS_CITY_FUZZ_SECONDS must be an integer between 1 and 3600');
  process.exit(2);
}

const resolveTool = (tool) => {
  const result = spawnSync('rustup', ['which', tool, '--toolchain', toolchain], {
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    console.error(result.stderr || `${toolchain} Rust toolchain is unavailable`);
    process.exit(result.status || 1);
  }
  return result.stdout.trim();
};

const nightlyCargo = resolveTool('cargo');
const nightlyRustc = resolveTool('rustc');
const fuzzEnvironment = {
  ...process.env,
  PATH: `${dirname(nightlyCargo)}${delimiter}${process.env.PATH ?? ''}`,
  RUSTC: nightlyRustc,
};
const fuzzDirectory = 'packages/hybrid-crypto/fuzz';
const targets = ['hybrid_raw', 'hybrid_roundtrip'];

for (const target of targets) {
  const args = mode === '--check'
    ? ['fuzz', 'check', '--fuzz-dir', fuzzDirectory, target]
    : [
        'fuzz', 'run', '--fuzz-dir', fuzzDirectory, target,
        '--', `-max_total_time=${durationSeconds}`, '-timeout=10',
      ];
  const result = spawnSync(nightlyCargo, args, {
    env: fuzzEnvironment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
