import WebSocket from 'ws';
import { randomId } from '../protocol.js';
import { wait } from './process.js';

type JsonObject = Record<string, unknown>;

export class WebSocketJsonRpc {
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private closed = false;

  private constructor(
    private readonly socket: WebSocket,
    private readonly onNotification: (method: string, params: JsonObject) => void,
    private readonly onRequest?: (method: string, params: JsonObject) => Promise<unknown>,
  ) {
    socket.on('message', (raw) => void this.receive(String(raw)));
    socket.on('close', () => this.failAll(new Error('native WebSocket closed')));
    socket.on('error', () => {});
  }

  static async connect(
    url: string,
    onNotification: (method: string, params: JsonObject) => void = () => {},
    onRequest?: (method: string, params: JsonObject) => Promise<unknown>,
    headers: Record<string, string> = {},
    timeoutMs = 15_000,
  ): Promise<WebSocketJsonRpc> {
    const deadline = Date.now() + timeoutMs;
    let last = 'not listening';
    while (Date.now() < deadline) {
      try {
        const socket = await open(url, headers);
        return new WebSocketJsonRpc(socket, onNotification, onRequest);
      } catch (error) {
        last = (error as Error).message;
        await wait(100);
      }
    }
    throw new Error(`native WebSocket did not become ready: ${last}`);
  }

  request(method: string, params: JsonObject = {}, timeoutMs = 30_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('native WebSocket is closed'));
    const id = randomId('rpc');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }), (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
      });
    });
  }

  notify(method: string, params: JsonObject = {}): Promise<void> {
    if (this.closed) return Promise.reject(new Error('native WebSocket is closed'));
    return new Promise((resolve, reject) => {
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }), (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  close(): void {
    this.closed = true;
    this.failAll(new Error('native WebSocket stopped'));
    try {
      this.socket.close();
    } catch {}
  }

  private async receive(raw: string): Promise<void> {
    let message: JsonObject;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const id = message.id === undefined ? '' : String(message.id);
    if (id && ('result' in message || 'error' in message) && !message.method) {
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (message.error) {
        const error = message.error as JsonObject;
        pending.reject(new Error(String(error.message || 'native JSON-RPC request failed')));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    const method = String(message.method || '');
    const params = object(message.params);
    if (!id) {
      if (method) this.onNotification(method, params);
      return;
    }
    try {
      if (!this.onRequest) throw new Error(`unsupported native request: ${method}`);
      const result = await this.onRequest(method, params);
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    } catch (error) {
      this.socket.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: (error as Error).message },
        }),
      );
    }
  }

  private failAll(error: Error): void {
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function open(url: string, headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('connection timed out'));
    }, 1_000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}
