const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Random id safe for file names and the project id pattern. Uses Web Crypto (browser and Node). */
export function newId(prefix = '', length = 10): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

/** Deterministic id generator for compilers and tests: same seed, same ids. */
export function idSequence(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}
