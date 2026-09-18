import type { Metadata } from 'next';
import { Page } from '@/components/page';
import { EXPLANATIONS } from '@/content/explanations';

export const metadata: Metadata = {
  title: 'Glossary',
  description: 'Every term One Moment uses, in plain words, how it works, and where it comes from.',
};

export default function GlossaryPage() {
  const terms = [...EXPLANATIONS].sort((a, b) => a.term.localeCompare(b.term));
  return (
    <Page
      eyebrow="Glossary"
      title="Every term, three ways"
      intro={<p>The same words as the info buttons across the site: in plain words, how it works, and the source. If something cannot be said in the plain column, it is not ready.</p>}
    >
      <dl className="divide-y divide-line rounded-2xl border border-line bg-raised">
        {terms.map((e) => (
          <div key={e.id} id={e.id} className="grid scroll-mt-24 gap-3 p-5 md:grid-cols-[12rem_1fr]">
            <dt className="font-semibold text-ink">{e.term}</dt>
            <dd className="space-y-2">
              <p className="text-ink">{e.plain}</p>
              <p className="text-sm text-muted">{e.technical}</p>
              {e.source && (
                <a href={e.source.href} target="_blank" rel="noreferrer" className="inline-block text-sm text-accent underline underline-offset-2">
                  {e.source.text}
                </a>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Page>
  );
}
