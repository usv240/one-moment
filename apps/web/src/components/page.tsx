// Shell for the reading pages: a title, a standfirst, and a readable measure.

export function Page({ eyebrow, title, intro, children }: {
  eyebrow?: string; title: string; intro?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-5xl px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
      <header className="max-w-3xl">
        {eyebrow && <p className="text-sm font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>}
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-5xl">{title}</h1>
        {intro && <div className="mt-5 text-lg leading-relaxed text-muted">{intro}</div>}
      </header>
      <div className="mt-12 space-y-16">{children}</div>
    </article>
  );
}

export function Block({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className="scroll-mt-24">
      <h2 id={id ? `${id}-h` : undefined} className="text-2xl font-semibold tracking-tight text-ink">{title}</h2>
      <div className="mt-5 space-y-4 leading-relaxed text-ink">{children}</div>
    </section>
  );
}

/** A plain data table that scrolls sideways on its own, never the page. */
export function Table({ head, rows, caption }: { head: string[]; rows: React.ReactNode[][]; caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[36rem] text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-sunken text-muted">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => <td key={j} className="px-4 py-3 text-ink">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>
);

export function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-line bg-sunken p-4 font-mono text-sm leading-relaxed text-ink">
      <code>{children}</code>
    </pre>
  );
}
