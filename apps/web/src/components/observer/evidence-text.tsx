// A proposed sentence, word by word, marked by where each word came from.
//
// The words stay in text ink. The evidence color is an underline plus an icon,
// never the color of the words, and every state also has a text label. Blocked
// words are struck through as well. Color is never the only carrier of meaning.

import { Fragment } from 'react';
import { Check, CircleHelp, Ban } from 'lucide-react';
import { contentWords, FRAMING, normalizeTokens } from '@one-moment/core';

export type Mark = 'grounded' | 'inferred' | 'vetoed' | 'plain';

const STYLE: Record<Exclude<Mark, 'plain'>, { line: string; Icon: typeof Check; label: string }> = {
  grounded: { line: 'decoration-grounded', Icon: Check, label: 'said by the caller' },
  inferred: { line: 'decoration-inferred', Icon: CircleHelp, label: 'worked out, needs agreement' },
  vetoed: { line: 'decoration-vetoed line-through', Icon: Ban, label: 'blocked, will not be said' },
};

export function markWords(sentence: string, heard: Set<string>, blocked: Set<string>): { word: string; mark: Mark }[] {
  const content = new Set(contentWords(sentence));
  return sentence.split(/\s+/).filter(Boolean).map((word) => {
    const n = normalizeTokens(word)[0] ?? '';
    // Function words and reporting framing ("says", "wants") carry no claim of their own.
    if (!content.has(n) || FRAMING.has(n)) return { word, mark: 'plain' as Mark };
    if (blocked.has(n)) return { word, mark: 'vetoed' as Mark };
    if (heard.has(n)) return { word, mark: 'grounded' as Mark };
    return { word, mark: 'inferred' as Mark };
  });
}

export function EvidenceText({ words }: { words: { word: string; mark: Mark }[] }) {
  return (
    <p className="leading-loose text-ink">
      {words.map((w, i) => {
        if (w.mark === 'plain') return <span key={i}>{w.word} </span>;
        const s = STYLE[w.mark];
        // The word and its icon never separate; the space after them is where lines break.
        return (
          <Fragment key={i}>
            <span className="whitespace-nowrap">
              <span title={s.label} className={`underline decoration-[3px] underline-offset-[5px] ${s.line}`}>
                {w.word}
              </span>
              <s.Icon aria-label={s.label} className={`mx-0.5 inline h-3 w-3 align-super ${w.mark === 'grounded' ? 'text-grounded' : w.mark === 'vetoed' ? 'text-vetoed' : 'text-inferred'}`} />
            </span>{' '}
          </Fragment>
        );
      })}
    </p>
  );
}

export function EvidenceLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {(Object.keys(STYLE) as (keyof typeof STYLE)[]).map((k) => {
        const s = STYLE[k];
        return (
          <li key={k} className="flex items-center gap-1.5">
            <s.Icon aria-hidden className={`h-3.5 w-3.5 ${k === 'grounded' ? 'text-grounded' : k === 'vetoed' ? 'text-vetoed' : 'text-inferred'}`} />
            {s.label}
          </li>
        );
      })}
    </ul>
  );
}
