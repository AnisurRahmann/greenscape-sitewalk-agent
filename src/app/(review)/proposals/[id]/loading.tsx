import { PageLoader } from '@/components/ui/page-loader';

export default function ProposalReviewLoading() {
  return (
    <div className="flex flex-col gap-4">
      <PageLoader label="Loading proposal…" />
      <header className="flex items-center justify-between">
        <div>
          <div className="h-6 w-40 animate-pulse rounded bg-muted" />
          <div className="mt-1.5 h-4 w-56 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-8 w-64 animate-pulse rounded-lg bg-muted" />
      </header>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <section className="flex min-w-0 flex-1 flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </section>
        <div className="w-full lg:w-80">
          <div className="h-96 animate-pulse rounded-xl border bg-muted/40" />
        </div>
      </div>
    </div>
  );
}
