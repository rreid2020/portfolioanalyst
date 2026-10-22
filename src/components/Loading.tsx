// What a page shows while its data loads, so a click in the sidebar responds at once.
export function PageSkeleton({ tiles = true }: { tiles?: boolean }) {
  return (
    <div className="mx-auto max-w-7xl animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-5 h-7 w-56 rounded bg-slate-200" />
      {tiles && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg border border-slate-200 bg-white" />)}
        </div>
      )}
      <div className="h-64 rounded-lg border border-slate-200 bg-white" />
    </div>
  );
}
