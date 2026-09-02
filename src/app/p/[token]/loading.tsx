export default function PublicProposalLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="h-28 animate-pulse rounded-2xl bg-muted" />
      <div className="mt-6 h-24 animate-pulse rounded bg-muted" />
      <div className="mt-6 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-muted" />
        ))}
      </div>
      <div className="mt-6 h-28 animate-pulse rounded-2xl bg-muted" />
    </main>
  );
}
