'use client';

// The info button. Opens on click or Enter or Space, never on hover alone
// (hover-only content is invisible to touch and keyboard users). Three tabs:
// in plain words, how it works, and where it comes from. The source tab only
// appears if there is a real source, and that absence is itself informative.

import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { explanation } from '@/content/explanations';

type Tab = 'plain' | 'technical' | 'source';

export function Explain({ id, className = '' }: { id: string; className?: string }) {
  const e = explanation(id);
  const [tab, setTab] = useState<Tab>('plain');
  if (!e) return null;
  const tabs: { key: Tab; label: string }[] = [
    { key: 'plain', label: 'In plain words' },
    { key: 'technical', label: 'How it works' },
    ...(e.source ? [{ key: 'source' as Tab, label: 'Source' }] : []),
  ];

  return (
    <Popover.Root onOpenChange={(o) => { if (o) setTab('plain'); }}>
      <Popover.Trigger
        aria-label={`What is ${e.term.toLowerCase()}?`}
        className={`inline-grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-strong text-[11px] font-semibold italic leading-none text-muted transition-colors hover:border-accent hover:text-accent ${className}`}
      >
        i
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line bg-raised p-4 text-sm shadow-3 outline-none"
        >
          <p className="mb-3 font-semibold text-ink">{e.term}</p>
          <div role="tablist" aria-label={`${e.term} explanation depth`} className="mb-3 flex gap-1 rounded-lg bg-sunken p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  tab === t.key ? 'bg-raised text-ink shadow-1' : 'text-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="leading-relaxed text-ink">
            {tab === 'plain' && <p>{e.plain}</p>}
            {tab === 'technical' && <p className="text-muted">{e.technical}</p>}
            {tab === 'source' && e.source && (
              <a href={e.source.href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                {e.source.text}
              </a>
            )}
          </div>
          <Popover.Arrow className="fill-[var(--bg-raised)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
