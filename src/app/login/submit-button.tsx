'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';

/** Submit button that shows its own pending state from the form action. */
export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-12 w-full text-base" disabled={pending}>
      {pending ? (
        <span className="flex items-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Signing in…
        </span>
      ) : (
        children
      )}
    </Button>
  );
}
