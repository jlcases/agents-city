export const OPERATIONS_SCHEMA = 'agents-city-operations/1';

export type OperationalEvent =
  | 'delivery_capacity'
  | 'delivery_flush'
  | 'relay_reconcile'
  | 'transparency_erasure'
  | 'witness_cosign';

export type OperationalOutcome =
  | 'ok'
  | 'degraded'
  | 'blocked'
  | 'failed'
  | 'rejected';

export type OperationalMetricValues = {
  durationMs?: number;
  units?: number;
  failures?: number;
  pending?: number;
  oldestPendingAgeMs?: number;
};

export type OperationalMetricsEnv = {
  APP_ENV?: string;
  OPERATIONS?: AnalyticsEngineDataset;
};

const environment = (value: string | undefined) => {
  if (value === 'production' || value === 'sandbox' || value === 'test') return value;
  return 'unknown';
};

const finiteOr = (value: number | undefined, fallback: number) => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

/**
 * Writes one privacy-bounded operational sample.
 *
 * Analytics Engine schema:
 * - index1: constant schema version (never a customer or request identifier)
 * - blob1..3: event, outcome, deployment environment
 * - double1..6: sample weight, duration ms, units, failures, pending, oldest age ms
 */
export const recordOperationalMetric = (
  env: OperationalMetricsEnv,
  event: OperationalEvent,
  outcome: OperationalOutcome,
  values: OperationalMetricValues = {},
  sampleRate = 1,
) => {
  if (!env.OPERATIONS) return false;
  const boundedRate = Math.min(1, Math.max(0, sampleRate));
  if (boundedRate === 0 || (boundedRate < 1 && Math.random() >= boundedRate)) return false;
  env.OPERATIONS.writeDataPoint({
    indexes: [OPERATIONS_SCHEMA],
    blobs: [event, outcome, environment(env.APP_ENV)],
    doubles: [
      1 / boundedRate,
      Math.max(0, finiteOr(values.durationMs, 0)),
      Math.max(0, finiteOr(values.units, 0)),
      Math.max(0, finiteOr(values.failures, 0)),
      Math.max(-1, finiteOr(values.pending, -1)),
      Math.max(-1, finiteOr(values.oldestPendingAgeMs, -1)),
    ],
  });
  return true;
};
