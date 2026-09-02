import { PageLoader } from '@/components/ui/page-loader';

/** /login awaits searchParams, so it is dynamic and genuinely suspends —
 *  without this it shows a blank screen instead. Mirrors the page's
 *  centered max-w-sm shell so the swap doesn't jump. */
export default function LoginLoading() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4">
      <div className="flex flex-col gap-6">
        <header>
          <div className="h-8 w-56 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-4 w-full animate-pulse rounded bg-muted" />
        </header>
        <PageLoader label="Checking your session…" />
        <div className="flex flex-col gap-2">
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          <div className="h-10 w-full animate-pulse rounded-md border bg-muted/40" />
        </div>
        <div className="h-12 w-full animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
}
