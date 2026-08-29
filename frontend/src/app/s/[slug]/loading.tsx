// Skeleton shown while the storefront / product Server Component awaits its
// data read. Matches the real header + product-grid layout so there's no
// jarring shift when content lands (CLS).
export default function StorefrontLoading() {
  return (
    <div className="min-h-screen animate-pulse bg-background font-body" aria-hidden="true">
      <div className="border-b border-border bg-card px-4 py-4 lg:px-14">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <div className="h-10 w-10 rounded-lg bg-secondary" />
          <div className="h-4 w-32 rounded bg-secondary" />
          <div className="ml-auto h-10 w-10 rounded-full bg-secondary" />
        </div>
      </div>
      <div className="border-b border-border bg-card px-4 py-6 lg:px-14">
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          <div className="h-16 w-16 rounded-lg bg-secondary" />
          <div className="space-y-2">
            <div className="h-6 w-48 rounded bg-secondary" />
            <div className="h-3 w-24 rounded bg-secondary" />
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-5xl px-4 py-10 lg:px-14">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="h-48 w-full bg-secondary" />
              <div className="space-y-3 p-5">
                <div className="h-4 w-3/4 rounded bg-secondary" />
                <div className="h-3 w-full rounded bg-secondary" />
                <div className="h-6 w-20 rounded bg-secondary" />
                <div className="h-10 w-full rounded-lg bg-secondary" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
