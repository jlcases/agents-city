import { ClaudeConnector } from './claude.js';
import { CodexConnector } from './codex.js';
import { KimiConnector } from './kimi.js';
import { OpenCodeConnector } from './opencode.js';
import { ConnectorOptions, NativeRuntime, RuntimeConnector } from './types.js';

export function createConnector(
  runtime: NativeRuntime,
  options: ConnectorOptions,
): RuntimeConnector {
  if (runtime === 'claude') return new ClaudeConnector(options);
  if (runtime === 'codex') return new CodexConnector(options);
  if (runtime === 'opencode') return new OpenCodeConnector(options);
  return new KimiConnector(options);
}
