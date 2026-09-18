'use client';

// "Where the pause went."
//
// The realtime API does not expose a mid-sentence pause as a gap between words;
// it stretches the words around it. Each bar is one word: the solid part is how
// long that word should take to say, the accent part is the extra time, which is
// the hidden pause. Summed, the extra time recovered 7186ms of a 7220ms pause.
//
// Form: one bar per word, two segments. Two segments means a legend, which is
// always present, plus a table view. A 2px surface gap separates the segments;
// hover or focus any bar for its exact numbers. Text stays in text ink.

import { useState } from 'react';
import { expectedWordMs, swallowedSilenceMs, type Word } from '@one-moment/core';
import { Explain } from '../explain';

export function PauseChart({ words }: { words: Word[] }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  if (!words.length) {
    return <p className="text-sm text-muted">Pauses appear here once a sentence is finished.</p>;
  }

  const rows = words.map((w) => {
    const dur = w.end - w.start;
    const expected = Math.min(dur, expectedWordMs(w.text));
    return { text: w.text, dur, expected, extra: Math.max(0, dur - expected), confidence: w.confidence };
  });
  const max = Math.max(...rows.map((r) => r.dur), 1);
  const hidden = swallowedSilenceMs(words);
  const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          Where the pause went
          <Explain id="swallowed-silence" />
        </span>
        <span className="font-mono text-xs text-muted">hidden pause recovered: {fmt(hidden)}</span>
      </figcaption>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-line-strong" />time to say the word</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-hold" />extra time: the pause, hidden inside it</span>
        <button type="button" onClick={() => setTable((v) => !v)} className="ml-auto rounded-md px-2 py-1 font-medium text-accent underline-offset-2 hover:underline">
          {table ? 'Show chart' : 'Show as table'}
        </button>
      </div>

      {table ? (
        <table className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr><th className="py-1 font-medium">Word</th><th className="font-medium">Duration</th><th className="font-medium">Expected</th><th className="font-medium">Extra</th><th className="font-medium">Confidence</th></tr>
          </thead>
          <tbody className="font-mono text-ink">
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1 font-sans">{r.text}</td><td>{r.dur}ms</td><td>{r.expected}ms</td><td>{r.extra}ms</td><td>{r.confidence.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="space-y-1.5" aria-label="Duration of each word">
          {rows.map((r, i) => (
            <li
              key={i}
              tabIndex={0}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${r.text}: ${r.dur} milliseconds, of which ${r.extra} extra`}
              className="relative grid grid-cols-[6.5rem_1fr] items-center gap-2 rounded-md outline-offset-1"
            >
              <span className="truncate text-right text-xs text-ink">{r.text}</span>
              <span className="flex h-3.5 items-center gap-[2px]">
                <span className="h-full rounded-l-[4px] bg-line-strong" style={{ width: `${(r.expected / max) * 100}%` }} />
                {r.extra > 0 && <span className="h-full rounded-r-[4px] bg-hold" style={{ width: `${(r.extra / max) * 100}%` }} />}
              </span>
              {hover === i && (
                <span role="tooltip" className="pointer-events-none absolute left-28 top-5 z-10 whitespace-nowrap rounded-md border border-line bg-raised px-2.5 py-1.5 font-mono text-xs text-ink shadow-2">
                  {r.dur}ms said, {r.expected}ms expected, <b>{r.extra}ms extra</b>, confidence {r.confidence.toFixed(2)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
