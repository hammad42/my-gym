import { Settings } from '../types';

/**
 * PIN / Password storage.
 *
 * The PIN / Password is never stored, exported, or synced in cleartext. What is stored is a
 * PBKDF2-SHA256 hash plus a random per-install salt, and even those are stripped
 * from every outbound payload (see `lib/sanitize.ts`).
 *
 * There is deliberately no default PIN: until the user sets one, the destructive action
 * stays protected and prompts the user to set a PIN first.
 */

export const PIN_MIN_LENGTH = 4;
const PBKDF2_ITERATIONS = 210_000;
const KEY_LENGTH_BITS = 256;
const SALT_BYTES = 16;

function getCrypto(): Crypto {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (!c || !c.subtle) {
    throw new Error(
      'Web Crypto is unavailable. MyGym must be served over HTTPS (or localhost) to secure your PIN.'
    );
  }
  return c;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Generates a random hex salt for a new PIN. */
export function generateSalt(): string {
  const bytes = new Uint8Array(SALT_BYTES);
  getCrypto().getRandomValues(bytes);
  return toHex(bytes.buffer);
}

/** Derives the PBKDF2-SHA256 hash of a PIN against a salt. Returns lowercase hex. */
export async function hashPin(pin: string, saltHex: string): Promise<string> {
  const crypto = getCrypto();
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: fromHex(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    KEY_LENGTH_BITS
  );

  return toHex(bits);
}

/** Compares two hex digests without leaking length or position through timing. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface PinCredentials {
  security_pin_hash: string;
  security_pin_salt: string;
}

/** Builds the stored credentials for a new PIN. */
export async function createPinCredentials(pin: string): Promise<PinCredentials> {
  const salt = generateSalt();
  const hash = await hashPin(pin, salt);
  return { security_pin_hash: hash, security_pin_salt: salt };
}

/** True when a PIN has actually been set by the user. */
export function isPinConfigured(
  settings: Pick<Settings, 'security_pin_hash' | 'security_pin_salt'> | undefined | null
): boolean {
  return Boolean(settings?.security_pin_hash && settings?.security_pin_salt);
}

/**
 * Verifies a candidate PIN against the stored credentials.
 * Returns false when no PIN has been configured — callers must gate on
 * `isPinConfigured` first so the user is told to set one rather than being
 * told their PIN is wrong.
 */
export async function verifyPin(
  candidate: string,
  settings: Pick<Settings, 'security_pin_hash' | 'security_pin_salt'> | undefined | null
): Promise<boolean> {
  if (!isPinConfigured(settings)) return false;
  const attempted = await hashPin(candidate, settings!.security_pin_salt!);
  return constantTimeEquals(attempted, settings!.security_pin_hash!);
}

/** Rejects PINs that are too short. Returns an error message, or null when acceptable. */
export function validateNewPin(pin: string, confirmation: string): string | null {
  const trimmed = pin.trim();
  if (trimmed.length < PIN_MIN_LENGTH) {
    return `Security PIN/password must be at least ${PIN_MIN_LENGTH} characters.`;
  }
  if (trimmed !== confirmation.trim()) {
    return 'PIN/password and confirmation do not match.';
  }
  return null;
}
