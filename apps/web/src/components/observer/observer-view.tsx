'use client';

// What is actually happening. Built for a judge, a clinician or an engineer:
// dense, precise, every claim checkable, every term one tap from an
// explanation. Nothing here is shown to the caller.

import { useState } from 'react';
import { ChevronDown, FlaskConical } from 'lucide-react';
import { swallowedSilenceMs } from '@one-moment/core';
import type { CallState } from '@/lib/use-call';
import { Explain } from '../explain';
import { DissentPanel } from './dissent-panel';
import { FloorStrip } from './floor-strip';
import { ListeningTwice } from './listening-twice';
import { PauseChart } from './pause-chart';
import { StatTiles } from './stat-tiles';
import { TheLine } from './the-line';
import { AuditPanel } from './audit-panel';

export function ObserverView({ state }: { state: CallState }) {
  const [logOpen, setLogOpen] = useState(false);
  const simulated = state.events.some((m) => m.type === 'simulation');
  const start = state.events[0]?.t ?? null;
  // The turn with the most hidden pause is the one worth looking at.
  const chartTurn = [...state.patientTurns].sort((a, b) => swallowedSilenceMs(b.words) - swallowedSilenceMs(a.words))[0];

  return (
    <section aria-labelledby="observer-h" className="space-y-8">
      <h2 id="observer-h" className="sr-only">What is actually happening</h2>
      {simulated && (
        <p className="flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-sm text-ink">
          <FlaskConical aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <span className="flex-1">
            Recorded demo: the caller and the pharmacist are computer voices. Both AssemblyAI streams, the Voice Agent,
            the rules and every decision below are running live, right now.
          </span>
          <Explain id="simulated" />
        </p>
      )}

      <StatTiles stats={state.stats} />
      <FloorStrip state={state.floor} events={state.events} />
      <ListeningTwice patientTurns={state.patientTurns} fastTurns={state.fastTurns} partial={state.partial} />
      <div className="rounded-xl border border-line bg-raised p-4">
        <PauseChart words={chartTurn?.words ?? []} />
      </div>
      <DissentPanel decisions={state.decisions} caller={state.caller} />
      <TheLine events={state.events} farLeg={state.farLeg} simulated={simulated} start={start} />
      <AuditPanel audit={state.audit} failed={state.auditFailed} pending={state.auditing} />

      {state.log.length > 0 && (
        <div className="rounded-xl border border-line">
          <button
            type="button"
            aria-expanded={logOpen}
            onClick={() => setLogOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-ink"
          >
            Engine log ({state.log.length})
            <ChevronDown aria-hidden className={`h-4 w-4 text-muted transition-transform ${logOpen ? 'rotate-180' : ''}`} />
          </button>
          {logOpen && (
            <ol className="max-h-72 space-y-1 overflow-y-auto border-t border-line px-4 py-3 font-mono text-xs text-muted">
              {state.log.map((l, i) => (
                <li key={i}>
                  <span className="text-subtle">{start !== null ? `${((l.t - start) / 1000).toFixed(1)}s` : ''}</span> {l.message}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
