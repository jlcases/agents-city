declare global {
  namespace Cloudflare {
    interface Env {
      ROADS_CONTROL_SECRET: string;
      SEALED_CAPABILITY_PEPPER_VERSION: string;
      SEALED_CAPABILITY_PEPPER_CURRENT: string;
      SEALED_CAPABILITY_PEPPER_PREVIOUS?: string;
      TRANSPARENCY_LOG: DurableObjectNamespace<import('../src/transparency-log').TransparencyLog>;
      CAPABILITY_SHARD: DurableObjectNamespace<import('../src/capability-shard').CapabilityShard>;
      ROAD_AUTHORITY: DurableObjectNamespace<import('../src/road-authority').RoadAuthority>;
      TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    }
  }
}

export {};
