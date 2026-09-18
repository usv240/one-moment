import { cite } from '@/content/citations';

/** A citation chip: the short name, linking to the source. */
export function Cite({ id }: { id: string }) {
  const c = cite(id);
  return (
    <a
      href={c.href}
      target="_blank"
      rel="noreferrer"
      title={c.full}
      className="ml-1 inline-flex items-center rounded-full border border-line px-2 py-0.5 align-middle text-[11px] font-medium leading-none text-muted no-underline transition-colors hover:border-accent hover:text-accent"
    >
      {c.short}
    </a>
  );
}

export function Section({ id, eyebrow, title, children, className = '' }: {
  id?: string; eyebrow?: string; title: string; children: React.ReactNode; className?: string;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className={`mx-auto max-w-7xl scroll-mt-24 px-4 py-16 sm:px-6 sm:py-24 ${className}`}>
      {eyebrow && <p className="text-sm font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>}
      <h2 id={id ? `${id}-h` : undefined} className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h2>
      <div className="mt-8">{children}</div>
    </section>
  );
}
