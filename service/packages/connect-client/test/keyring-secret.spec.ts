import { describe, expect, test } from 'vitest';
import { copyAndWipeKeyringSecret } from '../src/keyring-secret';

describe('native keyring secret normalization', () => {
  test('accepts and wipes Uint8Array and macOS number-array results', () => {
    const typed = new Uint8Array(32).fill(7);
    const array = new Array(32).fill(9);
    expect(copyAndWipeKeyringSecret(typed)).toEqual(new Uint8Array(32).fill(7));
    expect(copyAndWipeKeyringSecret(array)).toEqual(new Uint8Array(32).fill(9));
    expect(typed).toEqual(new Uint8Array(32));
    expect(array).toEqual(new Array(32).fill(0));
  });

  test('distinguishes a missing entry from malformed native output', () => {
    expect(copyAndWipeKeyringSecret(null)).toBeNull();
    expect(copyAndWipeKeyringSecret(undefined)).toBeNull();
    const malformed = [...new Array(31).fill(1), 256];
    expect(() => copyAndWipeKeyringSecret(malformed))
      .toThrow('invalid_ratchet_keyring_secret');
    expect(malformed).toEqual(new Array(32).fill(0));
    expect(() => copyAndWipeKeyringSecret('not bytes'))
      .toThrow('invalid_ratchet_keyring_secret');
  });
});
