import { DurableObject } from 'cloudflare:workers';

import { UUID_RE } from '../../../packages/service-protocol/src/index';

type RoadAuthorityStatus = 'provisioning' | 'active' | 'suspended' | 'revoked';

type RoadAuthorityState = {
  roadId: string;
  revision: number;
  status: RoadAuthorityStatus;
  updatedAt: number;
};

export type RoadAuthorityDecision = {
  authorized: boolean;
  revision: number;
  status: RoadAuthorityStatus | 'missing';
};

type RoadAuthorityMutation = {
  applied: boolean;
  revision: number;
  status: RoadAuthorityStatus;
};

const STATE_KEY = 'road';

const validRevision = (revision: number) => (
  Number.isSafeInteger(revision) && revision >= 1
);

const assertRoad = (roadId: string, revision: number) => {
  if (!UUID_RE.test(roadId) || !validRevision(revision)) {
    throw new Error('invalid_road_authority_request');
  }
};

export class RoadAuthority extends DurableObject {
  async stage(
    roadId: string,
    revision: number,
    resumeSuspended = false,
  ): Promise<RoadAuthorityMutation> {
    assertRoad(roadId, revision);
    return this.ctx.storage.transaction(async (transaction) => {
      const current = await transaction.get<RoadAuthorityState>(STATE_KEY);
      if (current && current.roadId !== roadId) {
        throw new Error('road_authority_name_collision');
      }
      if (
        current
        && (current.revision > revision
          || (current.revision === revision && current.status === 'revoked'))
      ) {
        return {
          applied: false,
          revision: current.revision,
          status: current.status,
        };
      }
      if (current?.revision === revision && current.status === 'active') {
        return {
          applied: true,
          revision: current.revision,
          status: current.status,
        };
      }
      if (
        current?.revision === revision
        && current.status === 'suspended'
        && !resumeSuspended
      ) {
        return {
          applied: false,
          revision: current.revision,
          status: current.status,
        };
      }
      const next: RoadAuthorityState = {
        roadId,
        revision,
        status: 'provisioning',
        updatedAt: Date.now(),
      };
      await transaction.put(STATE_KEY, next);
      return { applied: true, revision, status: next.status };
    });
  }

  async activate(
    roadId: string,
    revision: number,
  ): Promise<RoadAuthorityMutation> {
    assertRoad(roadId, revision);
    return this.ctx.storage.transaction(async (transaction) => {
      const current = await transaction.get<RoadAuthorityState>(STATE_KEY);
      if (
        !current
        || current.roadId !== roadId
        || current.revision !== revision
        || (current.status !== 'provisioning' && current.status !== 'active')
      ) {
        return {
          applied: false,
          revision: current?.revision ?? 0,
          status: current?.status ?? 'provisioning',
        };
      }
      const next: RoadAuthorityState = {
        ...current,
        status: 'active',
        updatedAt: Date.now(),
      };
      await transaction.put(STATE_KEY, next);
      return { applied: true, revision, status: next.status };
    });
  }

  async suspend(
    roadId: string,
    revision: number,
  ): Promise<RoadAuthorityMutation> {
    assertRoad(roadId, revision);
    return this.deny(roadId, revision, 'suspended');
  }

  async revoke(
    roadId: string,
    revision: number,
  ): Promise<RoadAuthorityMutation> {
    assertRoad(roadId, revision);
    return this.deny(roadId, revision, 'revoked');
  }

  async authorize(
    roadId: string,
    revision: number,
  ): Promise<RoadAuthorityDecision> {
    assertRoad(roadId, revision);
    const current = await this.ctx.storage.get<RoadAuthorityState>(STATE_KEY);
    if (current && current.roadId !== roadId) {
      throw new Error('road_authority_name_collision');
    }
    return {
      authorized: Boolean(
        current
        && current.revision === revision
        && current.status === 'active'
      ),
      revision: current?.revision ?? 0,
      status: current?.status ?? 'missing',
    };
  }

  async purge(roadId: string): Promise<{ purged: true }> {
    if (!UUID_RE.test(roadId)) throw new Error('invalid_road_authority_request');
    const current = await this.ctx.storage.get<RoadAuthorityState>(STATE_KEY);
    if (current && current.roadId !== roadId) {
      throw new Error('road_authority_name_collision');
    }
    await this.ctx.storage.deleteAll();
    return { purged: true };
  }

  private async deny(
    roadId: string,
    revision: number,
    status: 'suspended' | 'revoked',
  ): Promise<RoadAuthorityMutation> {
    return this.ctx.storage.transaction(async (transaction) => {
      const current = await transaction.get<RoadAuthorityState>(STATE_KEY);
      if (current && current.roadId !== roadId) {
        throw new Error('road_authority_name_collision');
      }
      if (current && current.revision > revision) {
        return {
          applied: false,
          revision: current.revision,
          status: current.status,
        };
      }
      const next: RoadAuthorityState = {
        roadId,
        revision,
        status: current?.status === 'revoked' ? 'revoked' : status,
        updatedAt: Date.now(),
      };
      await transaction.put(STATE_KEY, next);
      return { applied: true, revision, status: next.status };
    });
  }
}
