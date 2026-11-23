import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  configOf,
  deploy,
  infraOptions,
  type InfraHost,
  type WranglerResult,
} from '../../../../plugin/channel/managed-connect/infra';
import { resolveKeyTransparencyRootChain } from '../src/index';

const ACCOUNT = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);
const ok = (stdout = ''): WranglerResult => ({ status: 0, stdout, stderr: '' });

/** A Cloudflare account as wrangler shows it: enough of it to deploy onto. */
const cloudflare = (accounts = [{ id: ACCOUNT, name: 'Acme' }]) => {
  const state = {
    databases: [] as { uuid: string; name: string }[],
    roots: [] as { version: number; root_json: string }[],
    accounts: 0,
    spent: 0,
    secrets: {} as Record<string, Record<string, string>>,
    deployed: [] as string[],
    calls: [] as { args: string[]; input: string; account: string }[],
  };
  const wrangler: InfraHost['wrangler'] = (args, input = '', account = '') => {
    state.calls.push({ args, input, account });
    const config = () => JSON.parse(readFileSync(args[args.indexOf('--config') + 1]!, 'utf8'));
    if (args[0] === 'whoami') return ok(JSON.stringify({ loggedIn: true, accounts }));
    if (args[0] === 'deployments') {
      return state.deployed.includes(args[args.indexOf('--name') + 1]!)
        ? ok('[]')
        : { status: 1, stdout: '', stderr: 'This Worker does not exist on your account.' };
    }
    if (args[0] === 'd1' && args[1] === 'list') return ok(JSON.stringify(state.databases));
    if (args[0] === 'd1' && args[1] === 'create') {
      state.databases.push({ uuid: '11111111-1111-4111-8111-111111111111', name: args[2]! });
      return ok('created');
    }
    if (args[0] === 'd1' && args[1] === 'migrations') return ok('applied');
    if (args[0] === 'd1' && args[1] === 'execute' && args.includes('--command')) {
      const sql = args[args.indexOf('--command') + 1]!;
      const results = sql.includes('key_transparency_roots')
        ? state.roots
        : [{ accounts: state.accounts, spent: state.spent }];
      return ok(`banner\n${JSON.stringify([{ results, success: true }])}`);
    }
    if (args[0] === 'd1' && args[1] === 'execute' && args.includes('--file')) {
      const sql = readFileSync(args[args.indexOf('--file') + 1]!, 'utf8');
      const json = /'(\{.*\})'/s.exec(sql)![1]!.replaceAll("''", "'");
      state.roots.push({ version: JSON.parse(json).signed.version, root_json: json });
      return ok('executed');
    }
    if (args[0] === 'deploy') {
      const { name } = config();
      state.deployed.push(name);
      return ok(`Uploaded ${name}\n  https://${name}.acme.workers.dev\n`);
    }
    if (args[0] === 'secret' && args[1] === 'bulk') {
      const { name } = config();
      state.secrets[name] = { ...state.secrets[name], ...JSON.parse(input) };
      return ok('done');
    }
    return { status: 1, stdout: '', stderr: `unexpected: ${args.join(' ')}` };
  };
  return { state, wrangler };
};

describe('agents-city infra deploy', () => {
  let directory = '';
  let said: string[] = [];
  let keyring: Record<string, JsonWebKey> = {};
  const host = (wrangler: InfraHost['wrangler'], now = Date.now()): InfraHost => ({
    wrangler,
    serviceRoot: join(directory, 'service'),
    now: () => now,
    say: (line) => said.push(line),
    rootKeys: {
      load: async (name) => keyring[name] ?? null,
      save: async (name, key) => {
        keyring[name] = key;
      },
    },
  });
  const options = (...extra: string[]) =>
    infraOptions(['deploy', '--trust-file', join(directory, 'trust.json'), ...extra]);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'infra-spec-'));
    for (const piece of ['control', 'relay', 'witness']) {
      mkdirSync(join(directory, 'service', 'dist', piece), { recursive: true });
      writeFileSync(join(directory, 'service', 'dist', piece, 'index.js'), 'export default {};');
    }
    said = [];
    keyring = {};
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  test('a first run creates everything, and no secret ever rides on a command line', async () => {
    const { state, wrangler } = cloudflare();
    const done = await deploy(options('--as', 'ana'), host(wrangler));

    expect(state.deployed).toEqual(['agents-city-witness', 'agents-city-relay', 'agents-city-control']);
    expect(done).toMatchObject({
      service: 'https://agents-city-control.acme.workers.dev',
      relay: 'wss://agents-city-relay.acme.workers.dev/v1/connect',
      rootVersion: 1,
      createdKeys: true,
      firstAccountExists: false,
    });
    expect(done.bootstrapSecret).toHaveLength(43);
    expect(state.calls.slice(1).every(({ account }) => account === ACCOUNT)).toBe(true);

    // The two halves of each pair landed where they belong.
    const relay = state.secrets['agents-city-relay']!;
    const witness = state.secrets['agents-city-witness']!;
    const control = state.secrets['agents-city-control']!;
    expect(control.ROADS_CONTROL_SECRET).toBe(relay.ROADS_CONTROL_SECRET);
    expect(control.SIGNUP_BOOTSTRAP_SECRET).toBe(done.bootstrapSecret);
    expect(JSON.parse(relay.TRANSPARENCY_WITNESS_PUBLIC_JWK!).x)
      .toBe(JSON.parse(witness.WITNESS_PRIVATE_JWK!).x);
    expect(JSON.parse(witness.OPERATOR_PUBLIC_JWK!).x)
      .toBe(JSON.parse(relay.TRANSPARENCY_OPERATOR_PRIVATE_JWK!).x);
    expect(relay.TRANSPARENCY_WITNESS_URL)
      .toBe('https://agents-city-witness.acme.workers.dev/v1/cosign');

    // What a colleague is handed verifies as a client verifies it, and names
    // the keys that were deployed.
    const chain = JSON.parse(readFileSync(done.trustFile, 'utf8'));
    const { root, trust } = await resolveKeyTransparencyRootChain(chain, null);
    expect(root.signed.controlPlaneUrl).toBe(done.service);
    expect(root.signed.relayUrl).toBe(done.relay);
    expect(trust.operatorSigningPublicJwk.x)
      .toBe(JSON.parse(relay.TRANSPARENCY_OPERATOR_PRIVATE_JWK!).x);
    expect(Object.values(trust.witnessKeys)[0]!.x).toBe(JSON.parse(witness.WITNESS_PRIVATE_JWK!).x);

    // Private material: standard input and the keyring, nowhere else.
    const privates = [
      relay.ROADS_CONTROL_SECRET!,
      relay.SEALED_CAPABILITY_PEPPER_CURRENT!,
      done.bootstrapSecret!,
      JSON.parse(relay.TRANSPARENCY_OPERATOR_PRIVATE_JWK!).d as string,
      JSON.parse(witness.WITNESS_PRIVATE_JWK!).d as string,
      keyring[`${ACCOUNT}:agents-city`]!.d!,
    ];
    const visible = [
      ...state.calls.flatMap(({ args }) => args),
      ...said,
      readFileSync(done.trustFile, 'utf8'),
      ...state.roots.map(({ root_json }) => root_json),
    ].join('\n');
    for (const value of privates) expect(visible).not.toContain(value);
  });

  test('a second run upgrades the code and touches no key', async () => {
    const { state, wrangler } = cloudflare();
    const first = await deploy(options(), host(wrangler));
    const trust = readFileSync(first.trustFile, 'utf8');
    const secrets = structuredClone(state.secrets);
    state.calls.length = 0;
    state.deployed.length = 0;

    const second = await deploy(options(), host(wrangler));
    expect(second.createdKeys).toBe(false);
    expect(second.bootstrapSecret).toBeNull();
    expect(state.deployed).toHaveLength(3);
    expect(state.calls.some(({ args }) => args[0] === 'secret')).toBe(false);
    expect(state.calls.some(({ args }) => args[1] === 'create')).toBe(false);
    expect(state.secrets).toEqual(secrets);
    expect(state.roots).toHaveLength(1);
    expect(readFileSync(second.trustFile, 'utf8')).toBe(trust);
  });

  test('the operator secret is minted only while no account exists', async () => {
    const { state, wrangler } = cloudflare();
    await deploy(options(), host(wrangler));
    expect(state.secrets['agents-city-control']).not.toHaveProperty('SIGNUP_BOOTSTRAP_SECRET');

    const asked = await deploy(options('--as', 'ana'), host(wrangler));
    expect(asked.bootstrapSecret).not.toBeNull();
    // A failed sign-in is answered by running again: a new secret, not the old.
    const again = await deploy(options('--as', 'ana'), host(wrangler));
    expect(again.bootstrapSecret).not.toBe(asked.bootstrapSecret);

    state.spent = 1;
    const late = await deploy(options('--as', 'ana'), host(wrangler));
    expect(late).toMatchObject({ bootstrapSecret: null, firstAccountExists: true });
    expect(state.secrets['agents-city-control']!.SIGNUP_BOOTSTRAP_SECRET)
      .toBe(again.bootstrapSecret);
  });

  test('a root about to expire is renewed by the computer that holds its key', async () => {
    const { state, wrangler } = cloudflare();
    const start = Date.now();
    const first = await deploy(options(), host(wrangler, start));
    const pinned = JSON.parse(readFileSync(first.trustFile, 'utf8')).roots[0];

    const later = start + 300 * 24 * 60 * 60_000;
    const renewed = await deploy(options(), host(wrangler, later));
    expect(renewed.rootVersion).toBe(2);
    expect(state.roots).toHaveLength(2);
    // A client that pinned version 1 follows the chain to version 2.
    const chain = JSON.parse(readFileSync(renewed.trustFile, 'utf8'));
    const followed = await resolveKeyTransparencyRootChain(chain, pinned, later);
    expect(followed.root.signed.version).toBe(2);
    expect(followed.root.signed.expiresAt).toBe(renewed.rootExpiresAt);

    // Without the key nothing is replaced, and the operator is told.
    keyring = {};
    said = [];
    const stuck = await deploy(options(), host(wrangler, later + 300 * 24 * 60 * 60_000));
    expect(stuck.rootVersion).toBe(2);
    expect(state.roots).toHaveLength(2);
    expect(said.join('\n')).toMatch(/Warning: the root expires on \d{4}-\d{2}-\d{2}/);
  });

  test('it refuses rather than guess', async () => {
    const several = cloudflare([{ id: ACCOUNT, name: 'Acme' }, { id: OTHER, name: 'Personal' }]);
    await expect(deploy(options(), host(several.wrangler)))
      .rejects.toThrow(/several Cloudflare accounts[\s\S]*Acme[\s\S]*Personal/);
    expect(several.state.calls).toHaveLength(1);
    await expect(deploy(options('--account', 'c'.repeat(32)), host(several.wrangler)))
      .rejects.toThrow('cannot reach that --account');
    const chosen = await deploy(options('--account', OTHER), host(several.wrangler));
    expect(several.state.calls.slice(-1)[0]!.account).toBe(OTHER);
    expect(chosen.account).toBe('Personal');

    await expect(deploy(options(), host(() => ok(JSON.stringify({ loggedIn: false })))))
      .rejects.toThrow('wrangler login');

    // A service already published under one address is not moved to another.
    const moved = cloudflare();
    await deploy(options(), host(moved.wrangler));
    await expect(deploy(options('--name', 'other-name'), host((args, input, account) => {
      const result = moved.wrangler(args, input, account);
      return args[1] === 'list'
        ? ok(JSON.stringify([{ uuid: 'x', name: 'other-name-control' }]))
        : result;
    }))).rejects.toThrow('published under another address');

    // A Worker of that name that this command did not create is left alone.
    const taken = cloudflare();
    taken.state.deployed.push('agents-city-relay');
    await expect(deploy(options(), host(taken.wrangler)))
      .rejects.toThrow('a Worker named agents-city-relay already exists');
    expect(taken.state.databases).toEqual([]);
    expect(taken.state.deployed).toEqual(['agents-city-relay']);

    rmSync(join(directory, 'service', 'dist', 'relay'), { recursive: true });
    await expect(deploy(options(), host(cloudflare().wrangler))).rejects.toThrow('not built');
  });

  test('a failure shows what wrangler said and none of what was piped in', async () => {
    const { wrangler } = cloudflare();
    await expect(deploy(options(), host((args, input, account) => (
      args[0] === 'secret'
        ? { status: 1, stdout: '', stderr: 'X [ERROR] Authentication error [code: 10000]' }
        : wrangler(args, input, account)
    )))).rejects.toThrow(/setting the secrets of agents-city-witness failed:\s+X \[ERROR\] Authentication error/);
  });

  test('options are strict', () => {
    expect(infraOptions([]).command).toBe('help');
    expect(infraOptions(['deploy', '--help']).command).toBe('help');
    expect(infraOptions(['deploy'])).toMatchObject({ name: 'agents-city', account: '', as: '' });
    for (const [args, message] of [
      [['destroy'], 'unknown infra command'],
      [['deploy', '--name'], '--name needs a value'],
      [['deploy', '--name', 'Acme'], '--name is 3 to 32'],
      [['deploy', '--name', 'a', '--name', 'b'], 'given twice'],
      [['deploy', '--account', 'acme'], '--account is the 32-character id'],
      [['deploy', '--as', 'Ana María'], '--as is 1 to 32'],
      [['deploy', '--force'], 'unknown option: --force'],
    ] as const) expect(() => infraOptions([...args])).toThrow(message);
  });

  test('each piece is configured to run alone, with the bundle it ships', () => {
    const names = {
      witness: 'acme-witness', relay: 'acme-relay', control: 'acme-control', database: 'acme-control',
    };
    const relay = configOf('relay', names, 'db-id', '/srv', '') as Record<string, any>;
    expect(relay).toMatchObject({
      main: '/srv/dist/relay/index.js',
      no_bundle: true,
      vars: { APP_ENV: 'production' },
    });
    expect(relay.durable_objects.bindings).toHaveLength(5);
    expect(relay.migrations.flatMap((step: any) => step.new_sqlite_classes))
      .toEqual(relay.durable_objects.bindings.map((binding: any) => binding.class_name));
    const control = configOf('control', names, 'db-id', '/srv', 'wss://r/v1/connect') as Record<string, any>;
    expect(control.services).toEqual([{ binding: 'ROADS_BUS', service: 'acme-relay' }]);
    expect(control.vars.ROADS_PUBLIC_BUS_URL).toBe('wss://r/v1/connect');
    expect((configOf('witness', names, 'db-id', '/srv', '') as any).vars.APP_ENV).toBe('self-hosted');
  });
});
