import { describe, expect, it, vi } from 'vitest';

import {
  AuthorizationUnavailableError,
  retryAuthorizationRead,
} from '../src/authorization-recheck';

describe('Distributed Road authorization rechecks', () => {
  it('retries transient authority reads with bounded stagger before succeeding', async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('authority_busy'))
      .mockRejectedValueOnce(new Error('authority_busy'))
      .mockResolvedValue({ authorized: true, status: 'active', revision: 1 });
    const waits: number[] = [];

    await expect(retryAuthorizationRead('road-a', read, {
      wait: async (milliseconds) => { waits.push(milliseconds); },
    })).resolves.toEqual({ authorized: true, status: 'active', revision: 1 });
    expect(read).toHaveBeenCalledTimes(3);
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(50);
    expect(waits[1]).toBeGreaterThan(waits[0]!);
  });

  it('keeps an exhausted authority read distinct from a revoked Road', async () => {
    const failure = new Error('authority_unavailable');
    await expect(retryAuthorizationRead('road-b', async () => {
      throw failure;
    }, {
      attempts: 2,
      wait: async () => undefined,
    })).rejects.toMatchObject({
      name: 'AuthorizationUnavailableError',
      message: 'authorization_unavailable',
      cause: failure,
    } satisfies Partial<AuthorizationUnavailableError>);
  });
});
