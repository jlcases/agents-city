import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const NODE_WASM = 'kinsh_vodozemac_wasm_bg.wasm';
const banner = [
  "import { createRequire as __bundleCreateRequire } from 'node:module';",
  "import { fileURLToPath as __bundleFileURLToPath } from 'node:url';",
  "import { dirname as __bundleDirname } from 'node:path';",
  'const require = __bundleCreateRequire(import.meta.url);',
  'const __filename = __bundleFileURLToPath(import.meta.url);',
  'const __dirname = __bundleDirname(__filename);',
].join('\n');

export const buildClientArtifact = async ({
  root,
  prefix,
  entry,
  source,
  baseDirectory = tmpdir(),
  external = [],
}) => {
  const directory = await mkdtemp(join(baseDirectory, prefix));
  const outfile = join(directory, 'client.mjs');
  await copyFile(
    join(root, 'node_modules/@kinsh/vodozemac-wasm/pkg-node', NODE_WASM),
    join(directory, NODE_WASM),
  );
  await build({
    ...(source
      ? { stdin: { contents: source, loader: 'ts', resolveDir: root, sourcefile: 'client-entry.ts' } }
      : { entryPoints: [entry] }),
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: false,
    logLevel: 'silent',
    external,
    banner: { js: banner },
  });
  return { directory, outfile };
};

/**
 * Bundle the TypeScript client for a disposable Node E2E process. The upstream
 * vodozemac Node wrapper resolves its WASM next to the CommonJS module, while
 * our ML-KEM module normally resolves through import.meta.url. The harness
 * copies the first asset next to the bundle and injects the second explicitly,
 * so neither test depends on a source-tree-relative temporary URL.
 */
export const bundleConnectClient = async ({ root, entry, prefix }) => {
  const { directory, outfile } = await buildClientArtifact({
    root,
    entry,
    prefix,
  });
  const client = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  const hybridWasm = new Uint8Array(await readFile(
    join(root, 'packages/hybrid-crypto/pkg/agents_city_hybrid_crypto_bg.wasm'),
  ));
  await client.initializeHybridCrypto(hybridWasm);
  return { directory, client };
};

/** Bundle the browser-safe client and the Node vault entry for child-process QA. */
export const bundleNodeConnectClient = async ({ root, prefix }) => {
  const indexEntry = join(root, 'packages/connect-client/src/index.ts');
  const nodeEntry = join(root, 'packages/connect-client/src/node.ts');
  const artifact = await buildClientArtifact({
    root,
    prefix,
    baseDirectory: root,
    external: ['@napi-rs/keyring'],
    source: [
      `export * from ${JSON.stringify(indexEntry)};`,
      `export * from ${JSON.stringify(nodeEntry)};`,
    ].join('\n'),
  });
  return {
    ...artifact,
    hybridWasmPath: join(root, 'packages/hybrid-crypto/pkg/agents_city_hybrid_crypto_bg.wasm'),
  };
};
