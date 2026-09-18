import Link from 'next/link';
import { ThemeToggle } from './theme-toggle';

// Exactly four things, always in the same place (WCAG 3.2.6 consistent help):
// the wordmark, the demo, the page for judges, and the theme.
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur supports-[backdrop-filter]:bg-bg/75">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:h-16">
        <Link href="/" className="mr-auto flex items-center gap-2 rounded-md font-semibold tracking-tight">
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft">
            <span className="h-2.5 w-2.5 rounded-full bg-hold" />
          </span>
          <span>One Moment</span>
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
          <Link href="/demo" className="rounded-md px-3 py-2 font-medium text-ink hover:bg-sunken">
            Try it
          </Link>
          <Link href="/judges" className="hidden rounded-md px-3 py-2 font-medium text-muted hover:bg-sunken hover:text-ink sm:inline-block">
            For judges
          </Link>
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
