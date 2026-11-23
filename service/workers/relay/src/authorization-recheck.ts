const AUTHORIZATION_RECHECK_ATTEMPTS = 4;
const AUTHORIZATION_RECHECK_BASE_DELAY_MS = 50;

export class AuthorizationUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('authorization_unavailable', options);
    this.name = 'AuthorizationUnavailableError';
  }
}

const defaultWait = (milliseconds: number) => (
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
);

const stableJitter = (seed: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 101;
};

export const retryAuthorizationRead = async <Value>(
  seed: string,
  read: () => Promise<Value>,
  options: {
    attempts?: number;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
) => {
  const attempts = options.attempts ?? AUTHORIZATION_RECHECK_ATTEMPTS;
  const wait = options.wait ?? defaultWait;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await wait(
          AUTHORIZATION_RECHECK_BASE_DELAY_MS * (2 ** attempt)
          + stableJitter(seed),
        );
      }
    }
  }
  throw new AuthorizationUnavailableError({ cause: lastError });
};
