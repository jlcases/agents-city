const KEY_BYTES = 32;

/**
 * Native keyring backends do not agree on their JavaScript return shape:
 * macOS currently yields `number[]`, while other targets yield `Uint8Array`.
 * Validate before conversion and wipe the native-owned copy in every path.
 */
export const copyAndWipeKeyringSecret = (value: unknown): Uint8Array | null => {
  if (value === undefined || value === null) return null;
  const bytes = value instanceof Uint8Array
    ? [...value]
    : Array.isArray(value) ? value : null;
  try {
    if (
      !bytes
      || bytes.length !== KEY_BYTES
      || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
    ) throw new Error('invalid_ratchet_keyring_secret');
    return Uint8Array.from(bytes);
  } finally {
    if (value instanceof Uint8Array || Array.isArray(value)) value.fill(0);
  }
};
