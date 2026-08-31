import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Greenscape Pro — site-walk proposal agent',
};

export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Greenscape Pro</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Turns a contractor&apos;s spoken site-walk notes into a priced, reviewable
          proposal.
        </p>
      </header>

      <nav className="mt-8 flex flex-col gap-3">
        <Link
          href="/new"
          className="block rounded-xl border p-6 text-lg font-semibold transition-colors hover:bg-muted/40"
        >
          New site walk
        </Link>
        <Link
          href="/proposals"
          className="block rounded-xl border p-6 text-lg font-semibold transition-colors hover:bg-muted/40"
        >
          Proposals
        </Link>
      </nav>
    </div>
  );
}
