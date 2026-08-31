'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifyPassword,
} from '@/lib/auth/session';

/** Where a signed-in reviewer lands when the middleware didn't supply one. */
const DEFAULT_NEXT = '/new';

/** Exchanges the shared demo password for the signed session cookie. */
export async function signIn(formData: FormData): Promise<void> {
  const requested = formData.get('next');
  // Same-origin paths only — a foreign "next" would be an open redirect.
  const nextPath =
    typeof requested === 'string' && requested.startsWith('/') ? requested : DEFAULT_NEXT;

  const password = formData.get('password');
  if (typeof password !== 'string' || !(await verifyPassword(password))) {
    redirect(`/login?error=1&next=${encodeURIComponent(nextPath)}`);
  }

  const token = await createSessionToken();
  (await cookies()).set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

  redirect(nextPath);
}
