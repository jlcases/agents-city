declare global {
  namespace Cloudflare {
    interface Env {
      OPERATOR_KEY_ID: string;
      OPERATOR_PUBLIC_JWK: string;
      WITNESS_KEY_ID: string;
      WITNESS_PRIVATE_JWK: string;
      RELAY_ACCOUNT_ID: string;
      WITNESS_ACCOUNT_ID: string;
      WITNESS_DEPLOYMENT_ID: string;
      WITNESS_SOURCE_COMMIT: string;
    }
  }
}

export {};
