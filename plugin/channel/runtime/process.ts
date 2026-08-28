import { ChildProcess, spawn } from 'child_process';
import { createServer } from 'net';

export async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('could not allocate a loopback port');
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export function spawnNative(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  label: string,
  onOutput?: (text: string) => void,
): ChildProcess {
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = onOutput || ((text: string) => process.stderr.write(`[${label}] ${text}`));
  child.stdout?.on('data', (chunk) => output(String(chunk)));
  child.stderr?.on('data', (chunk) => output(String(chunk)));
  child.once('error', (error) => {
    process.stderr.write(`[${label}] could not start: ${error.message}\n`);
  });
  return child;
}

export function spawnNativeUi(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  return spawn(executable, args, { cwd, env, stdio: 'inherit' });
}

export async function waitForHttp(
  url: string,
  headers: Record<string, string> = {},
  child: ChildProcess | null = null,
  timeoutMs = 15_000,
): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let last = 'not listening';
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`native runtime exited before its server was ready (${child.exitCode})`);
    }
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(700) });
      if (response.ok) return response;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = (error as Error).message;
    }
    await wait(100);
  }
  throw new Error(`native runtime server did not become ready: ${last}`);
}

export async function terminate(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    wait(2_000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

export const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
