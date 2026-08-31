import 'server-only';

import { cookies } from 'next/headers';

import { SESSION_COOKIE_NAME, verifySessionToken } from './session';

/**
 * Middleware alone cannot protect Server Actions — they are invocable by ID
 * from the client bundle — so every mutating action re-verifies the session
 * cookie here before touching the database.
 */
export async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!(await verifySessionToken(token))) {
    throw new Error('Unauthenticated: sign in at /login');
  }
}
