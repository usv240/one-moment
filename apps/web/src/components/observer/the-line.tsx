'use client';

// "The line": the call as the other person experienced it.
//
// Every line the agent was allowed to say, next to proof that it was said:
// AssemblyAI's own transcript of the Voice Agent's speech, not our intent.
// Above it, one invariant, checked live: every word the agent spoke appears in
// a line the Floor Controller approved. If that ever fails, it says so in red.

import { Ban, Check, Clock, Headphones, Mic, Scissors, ShieldCheck } from 'lucide-react';
import type { ServerMessage } from '@one-moment/core';
import { Explain } from '../explain';

type Entry =
  | { who: 'caller'; text: string; t: number }
  | { who: 'agent'; kind: 'disclosure' | 'hold' | 'relay'; text: string; t: number; spoken: boolean; cut: boolean }
  | { who: 'far'; text: string; t: number };

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function lineOf(events: ServerMessage[]) {
  const entries: Entry[] = [];
  const spokenText: string[] = [];
  for (const m of events) {
    if (m.type === 'turn' && m.stream === 'patient' && m.turn.end_of_turn && m.turn.transcript) {
      entries.push({ who: 'caller', text: m.turn.transcript, t: m.t });
    } else if (m.type === 'outward') {
      entries.push({ who: 'agent', kind: m.kind, text: m.text, t: m.t, spoken: false, cut: false });
    } else if (m.type === 'far_heard') {
      entries.push({ who: 'far', text: m.text, t: m.t });
    } else if (m.type === 'agent_spoke') {
      spokenText.push(m.text);
      const said = norm(m.text);
      for (const e of entries) if (e.who === 'agent' && !e.cut && said.includes(norm(e.text))) e.spoken = true;
    } else if (m.type === 'agent_cut') {
      for (const e of entries) if (e.who === 'agent' && m.texts.includes(e.text)) { e.cut = true; e.spoken = false; }
    }
  }
  // The invariant, word by word: nothing the agent said may be absent from what was approved.
  const approved = new Set(entries.flatMap((e) => (e.who === 'agent' ? norm(e.text).split(' ') : [])));
  const unapproved = spokenText.flatMap((s) => norm(s).split(' ').filter((w) => w && !approved.has(w)));
  return { entries, spokenCount: spokenText.length, unapproved };
}

const KIND_LABEL = { disclosure: 'Says who it is', hold: 'Holds the floor', relay: 'Relays the caller' } as const;

export function TheLine({ events, farLeg, simulated, start }: {
  events: ServerMessage[];
  farLeg: 'voice-agent' | 'browser' | null;
  simulated: boolean;
  start: number | null;
}) {
  const { entries, spokenCount, unapproved } = lineOf(events);
  const at = (t: number) => (start === null ? '' : `${((t - start) / 1000).toFixed(1)}s`);
  const clean = unapproved.length === 0;

  return (
    <section aria-labelledby="line-h" className="space-y-3">
      <h3 id="line-h" className="flex items-center gap-2 text-base font-semibold text-ink">
        What the other person heard
        <Explain id="voice-agent-brain" />
      </h3>

      {farLeg === 'voice-agent' && spokenCount > 0 && (
        <p className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm text-ink ${clean ? 'border-line bg-raised' : 'border-vetoed bg-raised'}`}>
          {clean
            ? <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-grounded" />
            : <Ban aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-vetoed" />}
          <span>
            {clean
              ? <>Every word the agent spoke was in an approved line. Checked against AssemblyAI&apos;s own transcript of the agent, {spokenCount} {spokenCount === 1 ? 'reply' : 'replies'}.</>
              : <>The agent spoke words that were never approved: {unapproved.slice(0, 6).join(', ')}.</>}
          </span>
        </p>
      )}
      {farLeg === 'browser' && (
        <p className="rounded-lg bg-sunken px-3 py-2 text-sm text-muted">
          Fallback mode: no public address for the Voice Agent, so approved lines are spoken by this browser.
        </p>
      )}

      {!entries.length ? (
        <p className="text-sm text-muted">The call has not started.</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((e, i) => (
            <li key={i} className="grid grid-cols-[3.25rem_1fr] gap-3">
              <span className="pt-2.5 text-right font-mono text-xs text-muted">{at(e.t)}</span>
              {e.who === 'caller' ? (
                <div className="rounded-lg border border-line bg-raised px-3 py-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted"><Mic aria-hidden className="h-3.5 w-3.5" />Caller, heard by the patient ear</p>
                  <p className="text-sm text-ink">{e.text}</p>
                </div>
              ) : e.who === 'far' ? (
                <div className="rounded-lg border border-line bg-raised px-3 py-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
                    <Headphones aria-hidden className="h-3.5 w-3.5" />
                    {simulated ? 'Pharmacist (simulated), heard by the Voice Agent' : 'Other person, heard by the Voice Agent'}
                  </p>
                  <p className="text-sm text-ink">{e.text}</p>
                </div>
              ) : (
                <div className="rounded-lg border border-line bg-accent-soft px-3 py-2">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-medium text-muted">
                    <span>Agent: {KIND_LABEL[e.kind]}</span>
                    {farLeg === 'voice-agent' && (e.cut
                      ? <span className="flex items-center gap-1 text-ink"><Scissors aria-hidden className="h-3.5 w-3.5" />cut off: the caller spoke again</span>
                      : e.spoken
                        ? <span className="flex items-center gap-1 text-ink"><Check aria-hidden className="h-3.5 w-3.5 text-grounded" />spoken in full</span>
                        : <span className="flex items-center gap-1"><Clock aria-hidden className="h-3.5 w-3.5" />approved, waiting for a gap</span>)}
                  </p>
                  <p className="text-sm text-ink">{e.text}</p>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
