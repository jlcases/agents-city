import { BusEnvelope } from '../protocol.js';
import { NativeAcceptance } from '../runtime-metrics.js';

export type NativeRuntime = 'claude' | 'codex' | 'opencode' | 'kimi';

export interface RuntimeActivity {
  sourceId?: string;
  kind: string;
  thread?: string | null;
  phase?: string;
  tone?:
    'question' | 'work' | 'floor' | 'evidence' | 'decision' | 'verification' | 'error' | 'system';
  title: string;
  summary: string;
  details?: string[];
  target?: string;
}

export interface ConnectorOptions {
  actor: string;
  cwd: string;
  command: string;
  autoApprove: boolean;
  interactive: boolean;
  onActivity?: (activity: RuntimeActivity) => void;
  onDiagnostic?: (event: string, fields?: Record<string, unknown>) => void;
  onFatal?: (error: Error) => void;
}

export interface NativeUiCommand {
  executable: string;
  args: string[];
  cwd: string;
}

export interface RuntimeConnector {
  readonly runtime: NativeRuntime;
  readonly transport: string;
  start(): Promise<void>;
  waitUntilReady?(): Promise<void>;
  accept(prompt: string, envelope: BusEnvelope): Promise<NativeAcceptance>;
  nativeUi?(): NativeUiCommand | null;
  setNativeUiAttached?(attached: boolean): void;
  close(): Promise<void>;
}
