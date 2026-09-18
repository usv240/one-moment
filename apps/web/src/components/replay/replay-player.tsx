'use client';

// "A real call, scrubbable." Recorded data, not a video: the audio of one real
// call through the live system, and every event it produced, replayed through
// the same reducer the live view uses. Drag the timeline or step moment by
// moment with the arrow keys.

import { useRef } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import type { ServerMessage } from '@one-moment/core';
import { CallerView } from '@/components/caller-view';
import { FloorStrip } from '@/components/observer/floor-strip';
import { ObserverView } from '@/components/observer/observer-view';
import { TheLine } from '@/components/observer/the-line';
import { AuditPanel } from '@/components/observer/audit-panel';
import { useReplay, type Recording } from '@/lib/replay';

const fmt = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

const noop = () => {};

export function ReplayPlayer({ recording, audioSrc, compact = false, full = false }: {
  recording: Recording; audioSrc: string; compact?: boolean;
  /** Show the whole engine view (streams, chart, Dissent), not just the line. */
  full?: boolean;
}) {
  const r = useReplay(recording, audioSrc);
  const level = useRef(0);
  // Each marker is a 24px target (WCAG 2.5.8). Markers closer than 8% of the
  // track stack into rows, so no two targets overlap even on a phone.
  const rowEnds: number[] = [];
  const markers = r.moments.map((m) => {
    const x = (m.t / r.duration) * 100;
    let row = rowEnds.findIndex((end) => x - end >= 8);
    if (row === -1) { row = rowEnds.length; rowEnds.push(x); } else rowEnds[row] = x;
    return { ...m, x, row };
  });
  const rows = Math.max(1, rowEnds.length);
  const shown: ServerMessage[] = r.state.events;

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); r.step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); r.step(-1); }
    else if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); if (r.playing) r.pause(); else r.play(); }
  };

  return (
    <div onKeyDown={onKey} className="space-y-5">
      {/* The caption for this moment. Live region, so it is read as the call plays. */}
      <div aria-live="polite" className="min-h-[6.5rem] rounded-2xl border border-line bg-raised p-5 shadow-1">
        {r.current ? (
          <>
            <p className="text-lg font-semibold text-ink">{r.current.title}</p>
            <p className="mt-1 text-ink">{r.current.body}</p>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold text-ink">Press play to hear the call</p>
            <p className="mt-1 text-muted">About {Math.round(r.duration / 1000)} seconds. Sound on. Or step through it with the arrows.</p>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={r.playing ? r.pause : r.play}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-fg shadow-1 hover:bg-accent-hover"
        >
          {r.playing ? <Pause aria-hidden className="h-5 w-5" /> : <Play aria-hidden className="h-5 w-5" />}
          {r.playing ? 'Pause' : r.now > 0 && r.now < r.duration - 100 ? 'Resume' : 'Play the call'}
        </button>
        <div className="flex gap-1">
          <button type="button" aria-label="Previous moment" onClick={() => r.step(-1)} className="grid h-12 w-12 place-items-center rounded-xl border border-line-strong bg-raised text-ink hover:border-accent">
            <ChevronLeft aria-hidden className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Next moment" onClick={() => r.step(1)} className="grid h-12 w-12 place-items-center rounded-xl border border-line-strong bg-raised text-ink hover:border-accent">
            <ChevronRight aria-hidden className="h-5 w-5" />
          </button>
        </div>
        <span className="ml-auto font-mono text-sm tabular-nums text-muted">
          {fmt(r.now)} / {fmt(r.duration)}
        </span>
      </div>

      <div className="relative" style={{ paddingTop: `${rows * 24 + 2}px` }}>
        {/* Moment markers: each one is a real event in the log. */}
        <ol aria-label="Moments in the call" className="absolute inset-x-0 top-0">
          {markers.map((m, i) => (
            <li key={i} className="absolute -translate-x-1/2" style={{ left: `${m.x}%`, top: `${(rows - 1 - m.row) * 24}px` }}>
              <button
                type="button"
                title={m.title}
                aria-label={`Jump to: ${m.title}`}
                onClick={() => r.seek(m.t)}
                className="grid h-6 w-6 place-items-center rounded-full"
              >
                <span aria-hidden className={`block h-3 w-3 rounded-full border-2 ${m.t <= r.now ? 'border-accent bg-accent' : 'border-line-strong bg-raised'}`} />
              </button>
            </li>
          ))}
        </ol>
        <input
          type="range"
          min={0}
          max={r.duration}
          step={100}
          value={Math.round(r.now)}
          onChange={(e) => r.seek(Number(e.target.value))}
          aria-label="Position in the call"
          aria-valuetext={`${fmt(r.now)}${r.current ? `, ${r.current.title}` : ''}`}
          className="w-full accent-[var(--accent)]"
        />
      </div>

      <div className={`grid gap-6 ${compact ? 'lg:grid-cols-[minmax(18rem,22rem)_1fr]' : 'lg:grid-cols-[minmax(20rem,26rem)_1fr]'}`}>
        <div className="rounded-[2rem] border border-line bg-raised shadow-2">
          <p className="border-b border-line px-6 py-3 text-xs font-medium uppercase tracking-wider text-muted">Robert&apos;s screen</p>
          <div className={compact ? '[&_section]:min-h-[22rem]' : ''}>
            <CallerView state={r.state} level={level} onChoose={noop} onSomethingElse={noop} onStop={noop} />
          </div>
        </div>
        {full ? (
          <div className="min-w-0"><ObserverView state={r.state} /></div>
        ) : (
          <div className="min-w-0 space-y-6">
            <FloorStrip state={r.state.floor} events={shown} />
            <TheLine events={shown} farLeg={r.state.farLeg} simulated start={0} />
            <AuditPanel audit={r.state.audit} failed={r.state.auditFailed} pending={r.state.auditing} />
          </div>
        )}
      </div>
    </div>
  );
}
