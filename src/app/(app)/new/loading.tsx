import { PageLoader } from '@/components/ui/page-loader';

export default function NewSitewalkLoading() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-80 animate-pulse rounded bg-muted" />
      </header>
      <PageLoader label="Preparing the capture form…" />
      <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
    </div>
  );
}
