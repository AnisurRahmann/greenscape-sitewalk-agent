export default function ProposalsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted" />
      </header>
      <ul className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div className="h-5 w-24 animate-pulse rounded-full bg-muted" />
              <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className="h-8 animate-pulse rounded bg-muted" />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
