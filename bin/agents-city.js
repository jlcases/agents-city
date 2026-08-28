#!/usr/bin/env node
/* The npm front door: `npm install -g agents-city`, then `agents-city`.
 *
 * The same trick Claude Code uses — npm as the installer, the payload being
 * whatever the product actually is. Here the payload is the repo itself: the
 * Python that writes your files, the bash that builds your tmux session, and the
 * prebuilt map. Node is only the dispatcher, and it is guaranteed present because
 * npm just ran.
 *
 * Deliberately not a port to JS: the shared modules (card, parcels, units, roles)
 * are the product's single source of truth and every door reads them — the
 * installed Claude plugin included. Two languages holding one truth is the drift
 * disease this repo already caught once and killed.
 */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const RAIZ = path.dirname(__dirname);

const ORDENES = {
  hall: { que: ['bin/hall'], di: 'the town hall: manage your city from the browser' },
  seat: { que: ['bin/seat'], di: 'your chair: domain, seat role, repo-agent roles, goal, tmux' },
  cities: { que: ['bin/cities'], di: 'list, create or select your cities' },
  agents: { que: ['bin/agents'], di: 'list agents and manage their workspace mounts' },
  road: { que: ['bin/road'], di: 'connect two cities explicitly' },
  connect: { que: ['bin/connect'], di: 'pair this computer and open encrypted managed Roads' },
  bus: { que: ['bin/bus'], di: 'send information over those roads (seat only)' },
  committee: { que: ['bin/committee'], di: 'chair-mediated work with repo agents' },
  benchmark: { que: ['bin/benchmark'], di: 'offline stress/governance or opt-in live runtime latency' },
  logs: { que: ['bin/logs'], di: 'read or follow visible activity and operational diagnostics' },
  reset: { que: ['bin/reset'], di: 'reset one city to onboarding, recoverably' },
  uninstall: {
    que: ['bin/uninstall'],
    di: 'remove everything this wrote on this machine (previews first)',
  },
  skills: { que: ['bin/skills'], di: 'recognise the skills installed in each repo' },
  city: { que: ['bin/city'], di: 'draw your city' },
  shortcut: { que: ['bin/shortcut'], di: 'put a city on your desktop: icon, name, double-click' },
  demo: { que: ['bin/demo'], di: 'Aurora Games — see it working, no account' },
  setup: { que: ['bin/setup.py'], di: 'create or open a personal city' },
  report: { que: ['bin/report.py'], di: 'report growth from your folders' },
  tokens: { que: ['bin/tokens.py'], di: 'report token spend' },
  exit: { que: ['bin/exit'], di: 'close the day — every session and agent, or one city' },
  doctor: { que: ['bin/doctor'], di: 'check this machine: tools, runtimes, cage, city, version' },
  update: { que: ['bin/update'], di: 'install the newest published version (--check just asks)' },
  test: { que: ['bin/test'], di: 'every check in the repo' },
};

function ayuda() {
  const v = require(path.join(RAIZ, 'package.json')).version;
  console.log(`
  agents-city ${v} — autonomous cities for your coding agents

  usage: agents-city [command] [args]

  With no command it opens the town hall.
`);
  for (const [n, o] of Object.entries(ORDENES)) {
    console.log(`    ${n.padEnd(11)}${o.di}`);
  }
  console.log(`
  Needs python3 and tmux (the seat installs tmux itself). On Windows, run it
  inside WSL — the session is made of tmux windows, and there is no native tmux.
`);
}

function hay(programa) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'command',
    process.platform === 'win32' ? [programa] : ['-v', programa],
    { shell: process.platform !== 'win32', stdio: 'ignore' });
  return r.status === 0;
}

function main() {
  const args = process.argv.slice(2);
  const primera = args[0] || 'hall';

  if (primera === '--help' || primera === '-h' || primera === 'help') { ayuda(); return 0; }
  if (primera === '--version' || primera === '-v') {
    console.log(require(path.join(RAIZ, 'package.json')).version);
    return 0;
  }

  if (process.platform === 'win32') {
    console.error('\n  agents-city runs on tmux and bash, and Windows has neither');
    console.error('  natively. Install it inside WSL and run it from there:\n');
    console.error('    wsl -- npm install -g agents-city\n');
    return 1;
  }

  const orden = ORDENES[primera];
  const resto = orden ? args.slice(1) : args;
  const entrada = orden ? orden.que[0] : ORDENES.hall.que[0];
  if (!orden && args.length && primera.startsWith('-') === false) {
    console.error(`\n  No such command: ${primera}\n`);
    ayuda();
    return 1;
  }

  if (!hay('python3')) {
    console.error('\n  agents-city needs python3 on PATH — the files it manages are');
    console.error('  written by Python, the same modules every door shares.');
    console.error('  macOS: xcode-select --install   ·   Debian: apt install python3\n');
    return 1;
  }

  const guion = path.join(RAIZ, entrada);
  if (!fs.existsSync(guion)) {
    console.error(`\n  ${entrada} is missing from this install — reinstall:`);
    console.error('    npm install -g agents-city\n');
    return 1;
  }
  // Unbuffered, so the URL a server prints reaches a pipe as well as a terminal
  // — a CI log or a `| head` otherwise swallows it and the run looks silent.
  const r = spawnSync(guion, orden ? resto : args, {
    stdio: 'inherit', cwd: RAIZ,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  return r.status === null ? 1 : r.status;
}

process.exit(main());
