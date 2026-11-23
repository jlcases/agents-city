/**
 * `agents-city infra deploy`: the service, on the operator's own Cloudflare
 * account, from one command.
 *
 * It asks Cloudflare for nothing but what `wrangler login` already granted,
 * and never sees an API key. Everything secret is generated here and leaves
 * this process only through wrangler's standard input; the one key the
 * operator must keep, the root that signs who the service's keys are, goes to
 * the operating system's keyring.
 *
 * Running it again is how the service is upgraded: it creates what is
 * missing, leaves existing keys alone, and renews the root before it expires.
 */
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createKeyTransparencyRootSignature,
  hashKeyTransparencyRoot,
  parseKeyTransparencyRootChain,
  resolveKeyTransparencyRootChain,
  type KeyTransparencyRootEnvelope,
  type KeyTransparencyRootMetadata,
} from '../managed-connect-client.js';

const ROOT_PROTOCOL = 'agents-city-key-transparency-root/1';
const CHAIN_PROTOCOL = 'agents-city-key-transparency-root-chain/1';
const COMPATIBILITY_DATE = '2026-08-27';
const NAME = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const HANDLE = /^[a-z0-9_](?:[a-z0-9_-]{0,30}[a-z0-9_])?$/;
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const DAY_MS = 24 * 60 * 60_000;
/** The longest a root may live is 366 days; a day of margin for clock skew. */
const ROOT_LIFETIME_MS = 365 * DAY_MS;
const ROOT_RENEW_BEFORE_MS = 90 * DAY_MS;

const PIECES = ['witness', 'relay', 'control'] as const;
type Piece = (typeof PIECES)[number];

export type WranglerResult = { status: number; stdout: string; stderr: string };
/** `account` binds the call to one Cloudflare account once it is known. */
export type Wrangler = (args: string[], input?: string, account?: string) => WranglerResult;
export type RootKeyStore = {
  load(name: string): Promise<JsonWebKey | null>;
  save(name: string, key: JsonWebKey): Promise<void>;
};

export type InfraOptions = {
  command: 'deploy' | 'help';
  name: string;
  account: string;
  as: string;
  trustFile: string;
  json: boolean;
};

export type Deployment = {
  account: string;
  service: string;
  relay: string;
  witness: string;
  database: string;
  trustFile: string;
  rootVersion: number;
  rootExpiresAt: number;
  createdKeys: boolean;
  /** Set only when `--as` asked for the first account and none exists yet. */
  bootstrapSecret: string | null;
  firstAccountExists: boolean;
};

export type InfraHost = {
  wrangler: Wrangler;
  rootKeys: RootKeyStore;
  /** Where the built Workers and the migrations ship. */
  serviceRoot: string;
  now: () => number;
  say: (line: string) => void;
};

export function infraUsage(): string {
  return `Usage:
  agents-city infra deploy [--name NAME] [--account ID] [--as HANDLE] [--trust-file FILE]

Puts the Agents City service on your own Cloudflare account: a database, the
relay, the key log witness and the control plane. It uses the session that
\`wrangler login\` opened and asks for no API key.

  --name NAME        prefix of everything it creates (default: agents-city)
  --account ID       the Cloudflare account, when your login reaches several
  --as HANDLE        also make the first account, on this computer, and sign in
  --trust-file FILE  where to write the file colleagues need to sign in
                     (default: ./NAME-trust.json)

Run it again to upgrade the service. It never replaces a key that exists.`;
}

export function infraOptions(args: string[]): InfraOptions {
  const options: InfraOptions = {
    command: 'deploy',
    name: 'agents-city',
    account: '',
    as: '',
    trustFile: '',
    json: false,
  };
  const rest = [...args];
  const verb = rest.shift() ?? '';
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') {
    options.command = 'help';
    return options;
  }
  if (verb !== 'deploy') {
    throw new Error(`unknown infra command: ${verb}; see agents-city infra --help`);
  }
  const value = (flag: string): string => {
    const given = rest.shift();
    if (given === undefined || given.startsWith('--')) throw new Error(`${flag} needs a value`);
    return given;
  };
  const seen = new Set<string>();
  while (rest.length) {
    const flag = rest.shift() ?? '';
    if (flag === '--help' || flag === '-h') {
      options.command = 'help';
      return options;
    }
    if (seen.has(flag)) throw new Error(`${flag} was given twice`);
    seen.add(flag);
    if (flag === '--name') options.name = value(flag);
    else if (flag === '--account') options.account = value(flag);
    else if (flag === '--as') options.as = value(flag);
    else if (flag === '--trust-file') options.trustFile = value(flag);
    else if (flag === '--json') options.json = true;
    else throw new Error(`unknown option: ${flag}`);
  }
  if (!NAME.test(options.name)) {
    throw new Error(
      '--name is 3 to 32 lowercase letters, digits and dashes, starting with a letter',
    );
  }
  if (options.account && !ACCOUNT_ID.test(options.account)) {
    throw new Error('--account is the 32-character id that `wrangler whoami` prints');
  }
  if (options.as && !HANDLE.test(options.as)) {
    throw new Error('--as is 1 to 32 lowercase letters, digits, dashes and underscores');
  }
  return options;
}

const publicJwk = (jwk: JsonWebKey): JsonWebKey => ({
  kty: 'OKP',
  crv: 'Ed25519',
  x: jwk.x,
  ext: true,
});

function keyPair(): { publicJwk: JsonWebKey; privateJwk: JsonWebKey } {
  const generated = generateKeyPairSync('ed25519');
  const jwk = generated.privateKey.export({ format: 'jwk' }) as JsonWebKey;
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x || !jwk.d) {
    throw new Error('this Node could not generate an Ed25519 key');
  }
  return {
    publicJwk: publicJwk(jwk),
    privateJwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x, d: jwk.d, ext: true },
  };
}

const secret = (): string => randomBytes(32).toString('base64url');

/** The last lines wrangler wrote, with nothing that was piped into it. */
function failure(step: string, result: WranglerResult): Error {
  const detail = `${result.stderr}\n${result.stdout}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('⛅') && !/^[─-]+$/.test(line))
    .slice(-6)
    .join('\n  ');
  return new Error(`${step} failed${detail ? `:\n  ${detail}` : ''}`);
}

function jsonOf<T>(step: string, result: WranglerResult): T {
  if (result.status !== 0) throw failure(step, result);
  const text = result.stdout;
  // Wrangler may print a banner before the JSON it was asked for.
  const start = text.search(/[[{]/);
  try {
    return JSON.parse(start < 0 ? text : text.slice(start)) as T;
  } catch {
    throw new Error(`${step}: wrangler did not answer in JSON`);
  }
}

type Names = Record<Piece, string> & { database: string };

const namesOf = (prefix: string): Names => ({
  witness: `${prefix}-witness`,
  relay: `${prefix}-relay`,
  control: `${prefix}-control`,
  database: `${prefix}-control`,
});

/** The deployed configuration of each piece. Nothing in it is secret. */
export function configOf(
  piece: Piece,
  names: Names,
  databaseId: string,
  serviceRoot: string,
  relayUrl: string,
): Record<string, unknown> {
  const database = {
    binding: 'CONTROL',
    database_name: names.database,
    database_id: databaseId,
    migrations_dir: join(serviceRoot, 'migrations', 'control-plane'),
  };
  const base = {
    name: names[piece],
    main: join(serviceRoot, 'dist', piece, 'index.js'),
    no_bundle: true,
    compatibility_date: COMPATIBILITY_DATE,
    workers_dev: true,
    observability: { enabled: true },
  };
  if (piece === 'witness') {
    return {
      ...base,
      // One operator runs the log and its witness here, so the witness catches
      // an accident, not a dishonest operator. The name says so.
      vars: { APP_ENV: 'self-hosted' },
      durable_objects: {
        bindings: [{ name: 'WITNESS_STATE', class_name: 'TransparencyWitness' }],
      },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['TransparencyWitness'] }],
      ratelimits: [
        { name: 'WITNESS_COSIGN_LIMIT', namespace_id: '41002', simple: { limit: 600, period: 60 } },
      ],
    };
  }
  if (piece === 'relay') {
    const classes = [
      ['CITY_MAILBOX', 'CityMailbox'],
      ['DELIVERY_LANE', 'DeliveryLane'],
      ['TRANSPARENCY_LOG', 'TransparencyLog'],
      ['CAPABILITY_SHARD', 'CapabilityShard'],
      ['ROAD_AUTHORITY', 'RoadAuthority'],
    ] as const;
    return {
      ...base,
      vars: { APP_ENV: 'production', SEALED_CAPABILITY_PEPPER_VERSION: '1' },
      d1_databases: [database],
      durable_objects: {
        bindings: classes.map(([name, class_name]) => ({ name, class_name })),
      },
      migrations: classes.map(([, class_name], index) => ({
        tag: `v${index + 1}`,
        new_sqlite_classes: [class_name],
      })),
      ratelimits: [
        {
          name: 'SEALED_SUBMIT_LIMIT',
          namespace_id: '41001',
          simple: { limit: 120_000, period: 60 },
        },
      ],
      triggers: { crons: ['*/1 * * * *'] },
    };
  }
  return {
    ...base,
    vars: { APP_ENV: 'production', ROADS_PUBLIC_BUS_URL: relayUrl },
    d1_databases: [database],
    services: [{ binding: 'ROADS_BUS', service: names.relay }],
  };
}

const deployedUrl = (name: string, result: WranglerResult): string => {
  const found = new RegExp(`https://${name}\\.[a-z0-9-]+\\.workers\\.dev`).exec(
    `${result.stdout}\n${result.stderr}`,
  );
  if (!found) {
    throw new Error(
      `${name} was deployed but wrangler printed no workers.dev address; ` +
        'open Workers & Pages in the Cloudflare dashboard once to choose your subdomain, then run this again',
    );
  }
  return found[0];
};

type RootRow = { version: number; root_json: string };

async function firstRoot(
  service: string,
  relayUrl: string,
  keys: { root: JsonWebKey; operator: JsonWebKey; witness: JsonWebKey },
  ids: { root: string; operator: string; witness: string },
  rootPrivate: JsonWebKey,
  now: number,
): Promise<KeyTransparencyRootEnvelope> {
  const signed: KeyTransparencyRootMetadata = {
    protocol: ROOT_PROTOCOL,
    version: 1,
    environment: 'production',
    controlPlaneUrl: service,
    relayUrl,
    issuedAt: now,
    expiresAt: now + ROOT_LIFETIME_MS,
    previousRootHash: null,
    keys: { [ids.root]: keys.root, [ids.operator]: keys.operator, [ids.witness]: keys.witness },
    roles: {
      root: { keyIds: [ids.root], threshold: 1 },
      operator: { keyIds: [ids.operator], threshold: 1 },
      witness: { keyIds: [ids.witness], threshold: 1 },
    },
    maximumHeadAgeMs: 300_000,
    maximumWitnessLagMs: 30_000,
  };
  return {
    signed,
    signatures: [await createKeyTransparencyRootSignature(signed, ids.root, rootPrivate)],
  };
}

async function renewedRoot(
  latest: KeyTransparencyRootEnvelope,
  rootPrivate: JsonWebKey,
  now: number,
): Promise<KeyTransparencyRootEnvelope> {
  const rootId = latest.signed.roles.root.keyIds[0]!;
  const signed: KeyTransparencyRootMetadata = {
    ...latest.signed,
    version: latest.signed.version + 1,
    issuedAt: now,
    expiresAt: now + ROOT_LIFETIME_MS,
    previousRootHash: await hashKeyTransparencyRoot(latest.signed),
  };
  return {
    signed,
    signatures: [await createKeyTransparencyRootSignature(signed, rootId, rootPrivate)],
  };
}

const sqlText = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export async function deploy(options: InfraOptions, host: InfraHost): Promise<Deployment> {
  const { wrangler, say } = host;
  const names = namesOf(options.name);
  for (const piece of PIECES) {
    if (!existsSync(join(host.serviceRoot, 'dist', piece, 'index.js'))) {
      throw new Error(
        'the service is not built in this copy of Agents City; ' +
          'from a source checkout run `npm ci && npm run build:workers` in service/ first',
      );
    }
  }

  // 1. Whose Cloudflare.
  const who = wrangler(['whoami', '--json']);
  const identity =
    who.status === 0
      ? jsonOf<{ loggedIn?: boolean; accounts?: { id: string; name: string }[] }>('wrangler', who)
      : { loggedIn: false };
  if (!identity.loggedIn || !identity.accounts?.length) {
    throw new Error('wrangler is not signed in to Cloudflare; run `wrangler login` and try again');
  }
  const account = options.account
    ? identity.accounts.find(({ id }) => id === options.account)
    : identity.accounts.length === 1
      ? identity.accounts[0]
      : undefined;
  if (!account) {
    if (options.account) throw new Error('your wrangler login cannot reach that --account');
    throw new Error(
      'your wrangler login reaches several Cloudflare accounts; name one with --account:\n' +
        identity.accounts.map(({ id, name }) => `  ${id}  ${name}`).join('\n'),
    );
  }
  const cf = (args: string[], input?: string) => wrangler(args, input, account.id);
  say(`Cloudflare account: ${account.name}`);

  const scratch = mkdtempSync(join(tmpdir(), 'agents-city-infra-'));
  try {
    // 2. The database.
    type Database = { uuid: string; name: string };
    const find = () =>
      jsonOf<Database[]>('listing databases', cf(['d1', 'list', '--json'])).find(
        ({ name }) => name === names.database,
      );
    let database = find();
    if (!database) {
      const created = cf(['d1', 'create', names.database]);
      if (created.status !== 0) throw failure('creating the database', created);
      database = find();
      if (!database)
        throw new Error('Cloudflare created the database but does not list it yet; run this again');
      say(`Database: ${names.database} (created)`);
    } else say(`Database: ${names.database}`);

    const configPath = (piece: Piece, relayUrl = '') => {
      const path = join(scratch, `${piece}.json`);
      writeFileSync(
        path,
        JSON.stringify(configOf(piece, names, database!.uuid, host.serviceRoot, relayUrl), null, 2),
      );
      return path;
    };

    const migrated = cf([
      'd1',
      'migrations',
      'apply',
      'CONTROL',
      '--remote',
      '--config',
      configPath('relay'),
    ]);
    if (migrated.status !== 0) throw failure('applying the database migrations', migrated);

    // 3. The three pieces. The control plane binds to the relay, so it is last.
    const put = (piece: Piece, relayUrl = '') => {
      const result = cf(['deploy', '--config', configPath(piece, relayUrl)]);
      if (result.status !== 0) throw failure(`deploying ${names[piece]}`, result);
      const url = deployedUrl(names[piece], result);
      say(`Deployed: ${url}`);
      return url;
    };
    const witness = put('witness');
    const relayOrigin = put('relay');
    const relay = `${relayOrigin.replace(/^https:/, 'wss:')}/v1/connect`;
    const service = put('control', relay);

    // 4. Keys. The published root is the record of whether this service has
    // any: until one is published no client trusts anything here, so a first
    // run that died halfway is simply done again from scratch.
    const query = <T>(step: string, sql: string) =>
      jsonOf<{ results: T[] }[]>(
        step,
        cf(['d1', 'execute', names.database, '--remote', '--json', '--command', sql]),
      )[0]?.results ?? [];
    const execute = (step: string, sql: string) => {
      const file = join(scratch, 'statement.sql');
      writeFileSync(file, sql, { mode: 0o600 });
      const result = cf(['d1', 'execute', names.database, '--remote', '--yes', '--file', file]);
      rmSync(file, { force: true });
      if (result.status !== 0) throw failure(step, result);
    };
    const secrets = (piece: Piece, values: Record<string, string>) => {
      const result = cf(
        ['secret', 'bulk', '--config', configPath(piece, relay)],
        JSON.stringify(values),
      );
      if (result.status !== 0) throw failure(`setting the secrets of ${names[piece]}`, result);
    };
    const publish = async (root: KeyTransparencyRootEnvelope) => {
      const text = JSON.stringify(root);
      execute(
        'publishing the root',
        `INSERT INTO key_transparency_roots (version, root_hash, root_json, issued_at, expires_at)
         VALUES (${root.signed.version}, ${sqlText(await hashKeyTransparencyRoot(root.signed))},
                 ${sqlText(text)}, ${root.signed.issuedAt}, ${root.signed.expiresAt});`,
      );
    };

    const now = host.now();
    const stored = query<RootRow>(
      'reading the published roots',
      'SELECT version, root_json FROM key_transparency_roots ORDER BY version ASC',
    );
    let roots = stored.map(({ root_json }) => JSON.parse(root_json) as KeyTransparencyRootEnvelope);
    let createdKeys = false;
    if (!roots.length) {
      const root = keyPair();
      const operator = keyPair();
      const witnessKey = keyPair();
      const ids = {
        root: `${options.name}-root-v1`,
        operator: `${options.name}-operator-v1`,
        witness: `${options.name}-witness-v1`,
      };
      const first = await firstRoot(
        service,
        relay,
        { root: root.publicJwk, operator: operator.publicJwk, witness: witnessKey.publicJwk },
        ids,
        root.privateJwk,
        now,
      );
      // The root key is kept before anything depends on it.
      await host.rootKeys.save(`${account.id}:${options.name}`, root.privateJwk);
      const control = secret();
      secrets('witness', {
        OPERATOR_KEY_ID: ids.operator,
        OPERATOR_PUBLIC_JWK: JSON.stringify(operator.publicJwk),
        WITNESS_KEY_ID: ids.witness,
        WITNESS_PRIVATE_JWK: JSON.stringify(witnessKey.privateJwk),
      });
      secrets('relay', {
        ROADS_CONTROL_SECRET: control,
        SEALED_CAPABILITY_PEPPER_CURRENT: secret(),
        TRANSPARENCY_OPERATOR_PRIVATE_JWK: JSON.stringify(operator.privateJwk),
        TRANSPARENCY_OPERATOR_KEY_ID: ids.operator,
        TRANSPARENCY_WITNESS_URL: `${witness}/v1/cosign`,
        TRANSPARENCY_WITNESS_KEY_ID: ids.witness,
        TRANSPARENCY_WITNESS_PUBLIC_JWK: JSON.stringify(witnessKey.publicJwk),
      });
      secrets('control', { ROADS_CONTROL_SECRET: control });
      await publish(first);
      roots = [first];
      createdKeys = true;
      say('Keys: created; the root key is in this computer’s keyring');
    } else {
      const latest = roots.at(-1)!;
      if (latest.signed.controlPlaneUrl !== service || latest.signed.relayUrl !== relay) {
        throw new Error(
          'this service was published under another address; its clients trust that one. ' +
            'Deploy with the same --name and account as before',
        );
      }
      if (latest.signed.expiresAt - now < ROOT_RENEW_BEFORE_MS) {
        const rootPrivate = await host.rootKeys.load(`${account.id}:${options.name}`);
        if (rootPrivate) {
          const next = await renewedRoot(latest, rootPrivate, now);
          await publish(next);
          roots = [...roots, next];
          say(`Root: renewed, now version ${next.signed.version}`);
        } else {
          say(
            `Warning: the root expires on ${new Date(latest.signed.expiresAt).toISOString().slice(0, 10)} ` +
              'and its key is not in this computer’s keyring. Run this from the computer that first deployed the service.',
          );
        }
      }
    }

    // 5. What clients pin. Read back and verified exactly as a client would.
    const chain = parseKeyTransparencyRootChain({ protocol: CHAIN_PROTOCOL, roots });
    const verified = await resolveKeyTransparencyRootChain(chain, null, now);
    const trustFile = resolve(options.trustFile || `${options.name}-trust.json`);
    mkdirSync(dirname(trustFile), { recursive: true });
    writeFileSync(trustFile, `${JSON.stringify(chain, null, 2)}\n`);

    // 6. The first account, if asked for and still possible.
    const [state] = query<{ accounts: number; spent: number }>(
      'reading whether an account exists',
      'SELECT (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM service_bootstrap) AS spent',
    );
    const firstAccountExists = Boolean(state && (state.accounts > 0 || state.spent > 0));
    let bootstrapSecret: string | null = null;
    if (options.as && !firstAccountExists) {
      // Never stored: a run that fails after this point mints another.
      bootstrapSecret = secret();
      secrets('control', { SIGNUP_BOOTSTRAP_SECRET: bootstrapSecret });
    }

    return {
      account: account.name,
      service,
      relay,
      witness,
      database: names.database,
      trustFile,
      rootVersion: verified.root.signed.version,
      rootExpiresAt: verified.root.signed.expiresAt,
      createdKeys,
      bootstrapSecret,
      firstAccountExists,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The real wrangler: the one on PATH, or the one npx fetches. */
export function systemWrangler(): Wrangler {
  const probe = spawnSync('wrangler', ['--version'], { encoding: 'utf8' });
  const [command, prefix] =
    probe.status === 0 ? ['wrangler', [] as string[]] : ['npx', ['--yes', 'wrangler@4']];
  return (args, input, account) => {
    const environment: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
    if (account) environment.CLOUDFLARE_ACCOUNT_ID = account;
    const result = spawnSync(command, [...prefix, ...args], {
      encoding: 'utf8',
      env: environment,
      input: input ?? '',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) {
      return { status: 1, stdout: '', stderr: `could not run wrangler: ${result.error.message}` };
    }
    return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  };
}

export function keyringRootKeys(): RootKeyStore {
  const entry = async (name: string) => {
    const { AsyncEntry } = await import('@napi-rs/keyring');
    return new AsyncEntry('agents-city-infra-root', name);
  };
  return {
    async load(name) {
      try {
        const text = await (await entry(name)).getPassword();
        return text ? (JSON.parse(text) as JsonWebKey) : null;
      } catch {
        return null;
      }
    },
    async save(name, key) {
      try {
        await (await entry(name)).setPassword(JSON.stringify(key));
      } catch (error) {
        throw new Error(
          'the operating system keyring refused the root key, and without it the service could not be renewed in a year; nothing was created',
          { cause: error },
        );
      }
    },
  };
}

export const packagedServiceRoot = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'service');

/**
 * The command. `signIn` makes the first account with the secret this run
 * minted, so the operator never sees or types it.
 */
export async function infraCli(
  args: string[],
  signIn: (login: string[], bootstrapSecret: string) => Promise<void>,
): Promise<void> {
  const options = infraOptions(args);
  if (options.command === 'help') {
    console.log(infraUsage());
    return;
  }
  const host: InfraHost = {
    wrangler: systemWrangler(),
    rootKeys: keyringRootKeys(),
    serviceRoot: packagedServiceRoot(),
    now: Date.now,
    say: (line) => {
      if (!options.json) console.log(`  ${line}`);
    },
  };
  const done = await deploy(options, host);
  const login = ['--service', done.service, '--trust-file', done.trustFile];
  if (options.json) {
    const { bootstrapSecret: _never, ...shown } = done;
    console.log(JSON.stringify(shown, null, 2));
  } else {
    console.log(`\n  The service is at ${done.service}`);
    console.log(`  Trust file: ${done.trustFile}`);
  }
  if (done.bootstrapSecret) {
    await signIn(
      ['auth', 'login', ...login, '--as', options.as, '--bootstrap'],
      done.bootstrapSecret,
    );
  } else if (options.as && !options.json) {
    console.log('  The first account already exists; --as was not used.');
  }
  if (options.json) return;
  if (!done.firstAccountExists && !done.bootstrapSecret) {
    console.log('\n  Next, make the first account on this computer:');
    console.log(`    agents-city infra deploy --name ${options.name} --as <handle>`);
  }
  console.log(
    '\n  A colleague signs in with that file and a join code from `agents-city orgs invite`:',
  );
  console.log(
    `    agents-city auth login --service ${done.service} --trust-file <file> --as <handle> --join`,
  );
}
