#!/usr/bin/env node
/** Reproducible local reception-ingest capacity check. No network or model. */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  receptionDatabasePath,
  recordReceptionMessages,
} from '../../plugin/channel/managed-connect-client.js';

const integerArg = (name, fallback, minimum, maximum) => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
};

const total = integerArg('--messages', 1_000, 1, 100_000);
const batchSize = integerArg('--batch-size', 32, 1, 32);
const minimum = integerArg('--minimum', 1_000, 1, 1_000_000);
const root = mkdtempSync(join(tmpdir(), 'agents-city-reception-bench-'));
const context = {
  dataDir: root,
  appHome: root,
  runtimeDir: join(root, '.runtime', 'bus', 'city-target'),
  owner: 'owner',
  city: { id: 'city_target', address: 'owner/target', name: 'Target' },
  domain: 'custom',
  seatRole: '',
  actors: { seat: { role: 'chair' } },
  engines: { seat: 'claude' },
  roads: [],
};
const envelope = (index) => ({
  protocol: 'agents-city-bus/2',
  id: `managed_bench_${String(index).padStart(8, '0')}`,
  kind: 'road.message',
  scope: 'road',
  thread: null,
  from: { city: 'peer/source', actor: 'seat', role: 'external-seat' },
  to: { city: context.city.address, actor: 'seat' },
  createdAt: '2026-08-28T12:00:00.000Z',
  payload: {
    text: 'x'.repeat(256),
    transport: 'managed-e2ee',
    roadId: 'road_benchmark',
    remoteMessageId: String(index),
  },
});

try {
  // Exclude schema creation and first WAL setup from steady ingest.
  recordReceptionMessages(context, [envelope(total)]);
  const messages = Array.from({ length: total }, (_, index) => envelope(index));
  const started = performance.now();
  for (let index = 0; index < messages.length; index += batchSize) {
    recordReceptionMessages(context, messages.slice(index, index + batchSize));
  }
  const seconds = (performance.now() - started) / 1_000;
  const database = new DatabaseSync(receptionDatabasePath(root), { readOnly: true });
  const persisted = Number(
    database.prepare('SELECT COUNT(*) AS count FROM reception_messages').get().count,
  ) - 1;
  database.close();
  const messagesPerSecond = total / seconds;
  const result = {
    messages: total,
    batchSize,
    persisted,
    lost: total - persisted,
    seconds: Number(seconds.toFixed(3)),
    messagesPerSecond: Number(messagesPerSecond.toFixed(1)),
    minimum,
    passed: persisted === total && messagesPerSecond >= minimum,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
