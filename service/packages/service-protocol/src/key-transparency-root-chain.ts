import type { KeyTransparencyTrust } from './key-transparency';
import {
  applyKeyTransparencyRootUpdates,
  hashKeyTransparencyRoot,
  keyTransparencyTrustFromRoot,
  parseKeyTransparencyRootEnvelope,
  type KeyTransparencyRootEnvelope,
} from './key-transparency-root';

export const KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL = (
  'agents-city-key-transparency-root-chain/1'
) as const;

const MAX_CHAIN_ROOTS = 33;

export type KeyTransparencyRootChain = {
  protocol: typeof KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL;
  roots: KeyTransparencyRootEnvelope[];
};

export const parseKeyTransparencyRootChain = (value: unknown): KeyTransparencyRootChain => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_key_transparency_root_chain');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'protocol,roots'
    || record.protocol !== KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL
    || !Array.isArray(record.roots)
    || record.roots.length < 1
    || record.roots.length > MAX_CHAIN_ROOTS
  ) throw new Error('invalid_key_transparency_root_chain');

  const roots = record.roots.map(parseKeyTransparencyRootEnvelope);
  for (let index = 1; index < roots.length; index += 1) {
    if (
      roots[index]!.signed.version !== roots[index - 1]!.signed.version + 1
      || roots[index]!.signed.environment !== roots[0]!.signed.environment
    ) throw new Error('invalid_key_transparency_root_chain_sequence');
  }
  return { protocol: KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL, roots };
};

/**
 * Resolves a root chain from an out-of-band first pin, or advances a root that
 * the client has already persisted. The untrusted chain must contain the exact
 * persisted metadata before any later roots are considered.
 */
export const resolveKeyTransparencyRootChain = async (
  chainValue: unknown,
  persistedRootValue: unknown | null = null,
  now = Date.now(),
): Promise<{ root: KeyTransparencyRootEnvelope; trust: KeyTransparencyTrust }> => {
  const chain = parseKeyTransparencyRootChain(chainValue);
  if (persistedRootValue === null) {
    return keyTransparencyTrustFromRoot(chain.roots[0], chain.roots.slice(1), now);
  }

  const persisted = parseKeyTransparencyRootEnvelope(persistedRootValue);
  const matchingIndex = chain.roots.findIndex(
    ({ signed }) => signed.version === persisted.signed.version,
  );
  if (matchingIndex < 0) throw new Error('persisted_key_transparency_root_missing');
  if (
    await hashKeyTransparencyRoot(chain.roots[matchingIndex]!.signed)
    !== await hashKeyTransparencyRoot(persisted.signed)
  ) throw new Error('persisted_key_transparency_root_conflict');

  const root = await applyKeyTransparencyRootUpdates(
    persisted,
    chain.roots.slice(matchingIndex + 1),
    now,
  );
  return keyTransparencyTrustFromRoot(root, [], now);
};
