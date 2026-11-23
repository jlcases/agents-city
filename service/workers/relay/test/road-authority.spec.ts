import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const roadId = '90000000-0000-4000-8000-000000000001';

describe('Distributed Road authority', () => {
  beforeEach(async () => {
    await reset();
  });

  it('fails closed while provisioning and across suspension or revocation', async () => {
    const authority = env.ROAD_AUTHORITY.getByName(roadId);

    await expect(authority.authorize(roadId, 1)).resolves.toEqual({
      authorized: false,
      revision: 0,
      status: 'missing',
    });
    await expect(authority.stage(roadId, 1)).resolves.toMatchObject({
      applied: true,
      status: 'provisioning',
    });
    await expect(authority.authorize(roadId, 1)).resolves.toMatchObject({
      authorized: false,
      status: 'provisioning',
    });
    await expect(authority.activate(roadId, 1)).resolves.toMatchObject({
      applied: true,
      status: 'active',
    });
    await expect(authority.authorize(roadId, 1)).resolves.toMatchObject({
      authorized: true,
      status: 'active',
    });
    await expect(authority.stage(roadId, 1)).resolves.toMatchObject({
      applied: true,
      status: 'active',
    });
    await expect(authority.authorize(roadId, 1)).resolves.toMatchObject({
      authorized: true,
      status: 'active',
    });

    await authority.suspend(roadId, 1);
    await expect(authority.authorize(roadId, 1)).resolves.toMatchObject({
      authorized: false,
      status: 'suspended',
    });
    await expect(authority.activate(roadId, 1)).resolves.toMatchObject({
      applied: false,
      status: 'suspended',
    });
    await expect(authority.stage(roadId, 1)).resolves.toMatchObject({
      applied: false,
      status: 'suspended',
    });
    await expect(authority.stage(roadId, 1, true)).resolves.toMatchObject({
      applied: true,
      status: 'provisioning',
    });
    await authority.activate(roadId, 1);

    await authority.revoke(roadId, 2);
    await expect(authority.authorize(roadId, 2)).resolves.toMatchObject({
      authorized: false,
      revision: 2,
      status: 'revoked',
    });
    await expect(authority.stage(roadId, 2)).resolves.toMatchObject({
      applied: false,
      status: 'revoked',
    });
    await expect(authority.stage(roadId, 3)).resolves.toMatchObject({
      applied: true,
      revision: 3,
      status: 'provisioning',
    });
    await authority.activate(roadId, 3);
    await expect(authority.revoke(roadId, 2)).resolves.toMatchObject({
      applied: false,
      revision: 3,
      status: 'active',
    });
  });
});
