import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:grid-cols-4">
        <div className="space-y-2">
          <p className="font-semibold">Product</p>
          <ul className="space-y-1 text-muted">
            <li><Link className="hover:text-ink" href="/demo">Try it</Link></li>
            <li><Link className="hover:text-ink" href="/setup">Make it yours</Link></li>
            <li><Link className="hover:text-ink" href="/judges">For judges</Link></li>
            <li><Link className="hover:text-ink" href="/limits">What it does not do</Link></li>
          </ul>
        </div>
        <div className="space-y-2">
          <p className="font-semibold">Learn</p>
          <ul className="space-y-1 text-muted">
            <li><Link className="hover:text-ink" href="/#how">How it works</Link></li>
            <li><Link className="hover:text-ink" href="/evidence">Evidence</Link></li>
            <li><Link className="hover:text-ink" href="/glossary">Glossary</Link></li>
            <li><Link className="hover:text-ink" href="/accessibility">Accessibility report</Link></li>
          </ul>
        </div>
        <div className="space-y-2">
          <p className="font-semibold">Build</p>
          <ul className="space-y-1 text-muted">
            <li><Link className="hover:text-ink" href="/technology">Technology</Link></li>
            <li><Link className="hover:text-ink" href="/api">API and playground</Link></li>
            <li><span>MIT licence</span></li>
          </ul>
        </div>
        <div className="space-y-2">
          <p className="font-semibold">About</p>
          <p className="text-muted">
            Built for the AssemblyAI Voice Agent Hackathon, September 2026. Not a medical device.
            Not clinically validated.
          </p>
        </div>
      </div>
    </footer>
  );
}
