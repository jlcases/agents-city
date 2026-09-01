#!/usr/bin/env node
/* The npm front door: `npm install -g agents-city`, then `agents-city`.
 *
 * The same trick Claude Code uses — npm as the installer, the payload being
 * whatever the product actually is. Here the payload is the repo itself: the
 * Python that writes your files and builds your city, the Node that carries the
 * bus, and the prebuilt map. Node is only the dispatcher, and it is guaranteed
 * present because npm just ran.
 *
 * Every command used to go through a bash door, and fifteen of them were one
 * `exec python3 x.py "$@"` line — a spelling of the interpreter, in the one
 * language Windows does not have. They are named by their implementation now,
 * and this file picks the interpreter, so what is left needing a shell is five
 * commands rather than all of them.
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

/* Every command, named by what it IS rather than by the door it used to have.
 *
 * A door that was one `exec python3 x.py "$@"` line is not a door: it is a
 * spelling of the interpreter, and spelling it in bash is what kept this
 * product off Windows for the fifteen commands that never needed a shell at
 * all. So each entry says its kind, and this file picks the interpreter:
 *
 *   py    a Python module — everywhere
 *   node  a Node entry point — everywhere; `env` first resolves the city's
 *         settings, which the bash door used to do by sourcing city-env.sh
 *   sh    a door with shell logic of its own, and therefore POSIX for now
 */
const ORDENES = {
  hall: { sh: 'bin/hall', di: 'the town hall: manage your city from the browser' },
  seat: {
    py: 'plugin/scripts/seat.py',
    di: 'your chair: domain, seat role, repo-agent roles, goal, tmux',
  },
  cities: { py: 'plugin/scripts/cities.py', di: 'list, create or select your cities' },
  agents: {
    py: 'plugin/scripts/workspace.py',
    di: 'list agents and manage their workspace mounts',
  },
  road: { py: 'plugin/scripts/roads.py', di: 'connect two cities explicitly' },
  connect: {
    node: 'plugin/channel/managed-connect-cli.js',
    di: 'pair this computer and open encrypted managed Roads',
  },
  bus: {
    node: 'plugin/channel/client.js',
    antes: ['bus'],
    entorno: true,
    di: 'send information over those roads (seat only)',
  },
  committee: {
    node: 'plugin/channel/client.js',
    antes: ['committee'],
    entorno: true,
    di: 'chair-mediated work with repo agents',
  },
  benchmark: {
    sh: 'bin/benchmark',
    di: 'offline stress/governance or opt-in live runtime latency',
  },
  logs: {
    py: 'plugin/scripts/logs.py',
    di: 'read or follow visible activity and operational diagnostics',
  },
  reset: { py: 'plugin/scripts/reset.py', di: 'reset one city to onboarding, recoverably' },
  uninstall: {
    py: 'plugin/scripts/desinstala.py',
    di: 'remove everything this wrote on this machine (previews first)',
  },
  skills: {
    py: 'plugin/scripts/capabilities.py',
    di: 'recognise the skills installed in each repo',
  },
  city: { sh: 'bin/city', di: 'draw your city' },
  shortcut: {
    py: 'plugin/scripts/atajos.py',
    di: 'put a city on your desktop: icon, name, double-click',
  },
  demo: { sh: 'bin/demo', di: 'Aurora Games — see it working, no account' },
  setup: { py: 'bin/setup.py', di: 'create or open a personal city' },
  report: { py: 'bin/report.py', di: 'report growth from your folders' },
  tokens: { py: 'bin/tokens.py', di: 'report token spend' },
  exit: {
    py: 'plugin/scripts/apaga.py',
    di: 'close the day — every session and agent, or one city',
  },
  doctor: {
    py: 'plugin/scripts/doctor.py',
    di: 'check this machine: tools, runtimes, cage, city, version',
  },
  update: {
    py: 'plugin/scripts/actualiza.py',
    di: 'install the newest published version (--check just asks)',
  },
  test: { sh: 'bin/test', di: 'every check in the repo' },
};

/* Which Python. `python3` is the POSIX spelling and it is NOT what a Windows
 * install from python.org gives you — that is `python` and the `py` launcher,
 * and the Microsoft Store's `python3.exe` is a stub that opens the Store when
 * nothing is installed. So: ask, in order, and take the first that answers with
 * a version. Resolved once per run.
 */
let elInterprete;
function interprete() {
  if (elInterprete !== undefined) return elInterprete;
  const candidatos =
    process.platform === 'win32'
      ? [['python'], ['py', '-3'], ['python3']]
      : [['python3'], ['python']];
  for (const c of candidatos) {
    const r = spawnSync(c[0], [...c.slice(1), '-c', 'import sys; print(sys.version_info[0])'], {
      encoding: 'utf8',
    });
    if (r.status === 0 && String(r.stdout).trim() === '3') {
      elInterprete = c;
      return elInterprete;
    }
  }
  elInterprete = null;
  return elInterprete;
}


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
  const conShell = Object.entries(ORDENES).filter(([, o]) => o.sh).map(([n]) => n);
  console.log(`
  Needs Python 3, and a window server for the ones that open a city (the seat
  installs it itself).
`);
  if (process.platform === 'win32') {
    console.log(`  On Windows these still need WSL, because they are shell programs:
    ${conShell.join(', ')}
`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const primera = args[0] || 'hall';

  if (primera === '--help' || primera === '-h' || primera === 'help') { ayuda(); return 0; }
  if (primera === '--version' || primera === '-v') {
    console.log(require(path.join(RAIZ, 'package.json')).version);
    return 0;
  }

  const orden = ORDENES[primera] || ORDENES.hall;
  const resto = ORDENES[primera] ? args.slice(1) : args;
  if (!ORDENES[primera] && args.length && primera.startsWith('-') === false) {
    console.error(`\n  No such command: ${primera}\n`);
    ayuda();
    return 1;
  }

  // A door with shell logic of its own. Named, with what it is, rather than a
  // blanket "this product does not run here" — fifteen of these commands do.
  if (orden.sh && process.platform === 'win32') {
    console.error(`\n  \`agents-city ${primera}\` is still a shell program, and Windows has`);
    console.error('  no shell to run it in. Everything else on this install works;');
    console.error('  for this one, run it inside WSL:\n');
    console.error(`    wsl -- agents-city ${primera}\n`);
    return 1;
  }

  const objetivo = orden.sh || orden.py || orden.node;
  const guion = path.join(RAIZ, objetivo);
  if (!fs.existsSync(guion)) {
    console.error(`\n  ${objetivo} is missing from this install — reinstall:`);
    console.error('    npm install -g agents-city\n');
    return 1;
  }

  let programa = guion;
  let antes = [];
  if (orden.py) {
    const py = interprete();
    if (!py) {
      console.error('\n  agents-city needs Python 3 on PATH — the files it manages are');
      console.error('  written by Python, the same modules every door shares.');
      console.error('  macOS: xcode-select --install   ·   Debian: apt install python3');
      console.error('  Windows: winget install Python.Python.3.12\n');
      return 1;
    }
    programa = py[0];
    antes = [...py.slice(1), guion];
  } else if (orden.node) {
    programa = process.execPath;
    antes = [guion, ...(orden.antes || [])];
  }

  // The settings the bash doors used to establish by sourcing city-env.sh.
  // Asked of the one resolver, in the one shape a non-shell can read.
  // PYTHONUTF8 makes `open()` and stdout default to UTF-8 whatever code page
  // the console is on. Without it, on Windows, a card with an em dash is
  // written in cp1252 and read back as UTF-8 by the next door along.
  let entorno = {
    ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
  };
  if (orden.entorno) {
    const py = interprete();
    if (py) {
      const r = spawnSync(py[0], [...py.slice(1), path.join(RAIZ, 'plugin/scripts/city_env.py'),
        '--json'], { encoding: 'utf8' });
      if (r.status === 0) {
        try {
          entorno = { ...entorno, ...JSON.parse(r.stdout) };
        } catch {
          /* a resolver that cannot answer leaves the environment as it found it */
        }
      }
    }
  }

  // Unbuffered, so the URL a server prints reaches a pipe as well as a terminal
  // — a CI log or a `| head` otherwise swallows it and the run looks silent.
  const r = spawnSync(programa, [...antes, ...resto], {
    stdio: 'inherit', cwd: RAIZ, env: entorno,
  });
  return r.status === null ? 1 : r.status;
}

// Only when this IS the command. Exported so the checks can read the real map
// rather than a regex over this file — what each command runs, and which ones
// still need a shell, is exactly the thing that must not drift unnoticed.
if (require.main === module) process.exit(main());
module.exports = { ORDENES };
