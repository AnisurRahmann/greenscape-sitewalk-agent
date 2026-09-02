/** Unmistakable loading affordance for route-level loading.tsx files.
 *  Skeletons alone read as "broken layout" on fast connections; the spinner
 *  plus label says "working on it" while the shape-matching skeleton below
 *  previews the page. */
export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
      <span
        aria-hidden
        className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent"
      />
      {label}
    </div>
  );
}
