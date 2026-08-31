/**
 * Shared-password demo session: the cookie value is `<expiry epoch ms>.<hex
 * HMAC-SHA256 of that expiry>`, keyed by SESSION_SECRET. Web Crypto only, so
 * the same helpers run in middleware (edge runtime) and Server Actions (node).
 * Demo scope: one shared password, no users, no refresh — re-signing in mints
 * a fresh 7-day token.
 */

export const SESSION_COOKIE_NAME = 'demo_session';

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const encoder = new TextEncoder();

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('Missing SESSION_SECRET env var — generate one with `openssl rand -hex 32`');
  }
  return secret;
}

async function hmacHex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare so cookie checks don't leak the signature by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Mints a fresh cookie value with a 7-day expiry. */
export async function createSessionToken(): Promise<string> {
  const expiresAt = String(Date.now() + SESSION_TTL_SECONDS * 1000);
  return `${expiresAt}.${await hmacHex(expiresAt, getSessionSecret())}`;
}

/** True only when the signature verifies against SESSION_SECRET and the expiry is live. */
export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  try {
    const expected = await hmacHex(payload, getSessionSecret());
    if (!timingSafeEqual(signature, expected)) return false;
  } catch {
    // Unconfigured (or edge-inaccessible) secret must fail closed, not open.
    return false;
  }

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

/** Checks the shared demo password (DEMO_PASSWORD). Fails closed when unset. */
export async function verifyPassword(password: string): Promise<boolean> {
  const expected = process.env.DEMO_PASSWORD;
  if (!expected) {
    throw new Error('Missing DEMO_PASSWORD env var — set it before signing in');
  }
  return timingSafeEqual(password, expected);
}
