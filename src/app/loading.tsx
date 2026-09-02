import { PageLoader } from '@/components/ui/page-loader';

/** Global fallback: covers every route that has no loading.tsx of its own
 *  (currently `/` and anything added in the future without one). */
export default function RootLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <PageLoader label="Loading Greenscape Pro…" />
    </div>
  );
}
