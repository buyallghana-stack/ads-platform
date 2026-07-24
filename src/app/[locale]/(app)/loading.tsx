/**
 * Instant skeleton for any signed-in page while its data loads.
 *
 * The persistent shell (sidebar / bottom tabs) stays put — this only fills the
 * main content area — so a navigation feels immediate instead of the blank
 * 10-15s a full reload cost on slow mobile. Shapes mirror the Home tab so the
 * swap to real content is a fade, not a jump. `animate-pulse` is opacity-only
 * (GPU-cheap) and the global prefers-reduced-motion rule stills it.
 */
function Block({ className = '' }: { className?: string }) {
  return <div className={`rounded-(--radius-input) bg-ink-200 ${className}`} />
}

export default function AppLoading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl animate-pulse flex-col gap-5 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      {/* greeting */}
      <div className="flex flex-col gap-2">
        <Block className="h-5 w-40" />
        <Block className="h-3 w-56 bg-ink-100" />
      </div>

      {/* balance hero */}
      <Block className="h-40 rounded-(--radius-panel) bg-ink-200/70" />

      {/* stat row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Block className="h-24" />
        <Block className="h-24" />
        <Block className="col-span-2 h-24 lg:col-span-1" />
      </div>

      {/* chart + rail */}
      <div className="grid gap-5 xl:grid-cols-3">
        <Block className="hidden h-72 md:block xl:col-span-2" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
          <Block className="h-40" />
          <Block className="h-32" />
        </div>
      </div>

      {/* history */}
      <Block className="h-64" />
    </div>
  )
}
