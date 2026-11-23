export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export const base64urlDecodedLength = (value: string) => {
  if (!BASE64URL_RE.test(value)) return Number.POSITIVE_INFINITY;
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const decoded = atob(padded);
    const canonical = btoa(decoded)
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    return canonical === value ? decoded.length : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

export const standardBase64DecodedLength = (value: string) => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) {
    return Number.POSITIVE_INFINITY;
  }
  try {
    return atob(value.padEnd(Math.ceil(value.length / 4) * 4, '=')).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};
