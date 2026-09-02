import type { Metadata } from 'next';

import { signIn } from '@/app/login/actions';
import { SubmitButton } from '@/app/login/submit-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const metadata: Metadata = { title: 'Sign in — Greenscape Pro' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4">
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Greenscape Pro</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This demo is password gated — enter the shared password to continue.
          </p>
        </header>

        <form action={signIn} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next ?? ''} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              aria-invalid={Boolean(error)}
            />
            {error && <p className="text-sm text-destructive">Wrong password — try again.</p>}
          </div>
          <SubmitButton>Sign in</SubmitButton>
        </form>
      </div>
    </div>
  );
}
