import { describe, expect, it, vi } from 'vitest';
import {
  OPERATIONS_SCHEMA,
  recordOperationalMetric,
} from '../../shared/operational-metrics';

describe('privacy-bounded operational metrics', () => {
  it('writes only the closed aggregate schema', () => {
    const writeDataPoint = vi.fn();
    const written = recordOperationalMetric({
      APP_ENV: 'sandbox',
      OPERATIONS: { writeDataPoint },
    }, 'delivery_flush', 'ok', {
      durationMs: 41,
      units: 32,
      failures: 0,
      pending: 7,
      oldestPendingAgeMs: 250,
    });

    expect(written).toBe(true);
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: [OPERATIONS_SCHEMA],
      blobs: ['delivery_flush', 'ok', 'sandbox'],
      doubles: [1, 41, 32, 0, 7, 250],
    });
    const serialized = JSON.stringify(writeDataPoint.mock.calls[0][0]);
    for (const forbidden of [
      'alex/product', 'device-123', 'road-456', 'message-789',
      'ticket-secret', 'capability-secret', 'https://relay.example',
      'ciphertext-value', 'plaintext-value',
    ]) expect(serialized.toLowerCase()).not.toContain(forbidden);
  });

  it('samples healthy hot-path events and records the inverse weight', () => {
    const writeDataPoint = vi.fn();
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.5).mockReturnValueOnce(0.0005);
    const env = { APP_ENV: 'sandbox', OPERATIONS: { writeDataPoint } };

    expect(recordOperationalMetric(env, 'delivery_flush', 'ok', {}, 0.001)).toBe(false);
    expect(recordOperationalMetric(env, 'delivery_flush', 'ok', {}, 0.001)).toBe(true);
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    expect(writeDataPoint.mock.calls[0][0].doubles[0]).toBe(1_000);
    vi.restoreAllMocks();
  });

  it('fails open when the analytics binding is unavailable', () => {
    expect(recordOperationalMetric({}, 'relay_reconcile', 'failed', { failures: 1 })).toBe(false);
  });
});
