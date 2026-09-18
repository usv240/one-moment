'use client';

// "Two AIs argue. A rule decides."
//
// The Advocate proposes what to say for the caller. The Skeptic reads the same
// evidence independently and looks for a lost "not" or a word nobody said. The
// Adjudicator is not a model: it is a fixed list of rules, checked in order,
// and the first one that matches decides. Most turns never reach a model at
// all, because a complete, clear sentence is relayed in the caller's own words.

import { useState } from 'react';
import { Ban, Check, CircleHelp, Pause, Scale, ShieldAlert, Sparkles } from 'lucide-react';
import { contentWords, POLICY_RULES, type DissentResult } from '@one-moment/core';
import type { DecisionRecord } from '@/lib/use-call';
import { Explain } from '../explain';
import { EvidenceLegend, EvidenceText, markWords } from './evidence-text';

const ACTION = {
  relay: { Icon: Check, label: 'Say it', tone: 'text-grounded' },
  ask: { Icon: CircleHelp, label: 'Ask the caller first', tone: 'text-inferred' },
  hold: { Icon: Pause, label: 'Keep waiting', tone: 'text-muted' },
} as const;

function Card({ title, who, explain, wide, children }: { title: string; who: string; explain?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-raised p-4 ${wide ? 'md:col-span-2' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="text-xs text-muted">{who}</p>
        </div>
        {explain && <Explain id={explain} />}
      </div>
      {children}
    </div>
  );
}

const Absent = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-lg bg-sunken px-3 py-2 text-sm text-muted">{children}</p>
);

function Finding({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-ink">
      {ok
        ? <Check aria-label="passed" className="mt-0.5 h-4 w-4 shrink-0 text-grounded" />
        : <Ban aria-label="failed" className="mt-0.5 h-4 w-4 shrink-0 text-vetoed" />}
      <span>{children}</span>
    </li>
  );
}

function whyNoModels(r: DissentResult): string {
  switch (r.decision.policyRule) {
    case 9: return 'No model needed. The caller finished a clear sentence, so their own words are relayed.';
    case 1: return 'Not asked. The two listeners disagree about a "not", and no model is allowed to settle that. Only the caller can.';
    case 7: return 'Not asked. The caller is still speaking.';
    case 10: return 'Unavailable. The shared model is at its rate limit, so the system asks the caller rather than guess.';
    default: return 'No proposal.';
  }
}

export function DissentPanel({ decisions, caller }: { decisions: DecisionRecord[]; caller: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  if (!decisions.length) {
    return (
      <section aria-labelledby="dissent-h" className="space-y-3">
        <Heading />
        <Absent>When the caller finishes a sentence, the decision about what to say for them appears here.</Absent>
      </section>
    );
  }
  const index = picked ?? decisions.length - 1;
  const { result: r, evidence: ev } = decisions[index]!;
  const d = r.decision;
  const a = ACTION[d.action];
  const rule = POLICY_RULES[d.policyRule];

  const heard = new Set([
    ...contentWords(ev?.patientTranscript ?? ''),
    ...contentWords(ev?.fastTranscript ?? ''),
    ...contentWords(caller),
  ]);
  const blocked = new Set(r.deterministic.invented);
  const proposal = r.advocate?.say ?? (d.action === 'relay' ? d.text : null);

  return (
    <section aria-labelledby="dissent-h" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading />
        {decisions.length > 1 && (
          <div role="group" aria-label="Choose a turn" className="flex flex-wrap gap-1">
            {decisions.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-pressed={i === index}
                onClick={() => setPicked(i === decisions.length - 1 ? null : i)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${i === index ? 'bg-accent text-accent-fg' : 'bg-sunken text-muted hover:text-ink'}`}
              >
                Turn {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
      <EvidenceLegend />

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Advocate" who="Proposes what to say for the caller" explain="dissent">
          {proposal ? (
            <EvidenceText words={markWords(proposal, heard, blocked)} />
          ) : (
            <Absent>{whyNoModels(r)}</Absent>
          )}
          {!r.advocate && proposal && (
            <p className="flex items-start gap-1.5 text-xs text-muted">
              <Sparkles aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {whyNoModels(r)}
            </p>
          )}
          {r.advocate?.guessed.length ? (
            <p className="text-xs text-muted">Says it guessed: {r.advocate.guessed.join(', ')}</p>
          ) : null}
        </Card>

        <Card title="Skeptic" who="Reads the same evidence, looks for what could be wrong">
          {r.skeptic ? (
            <>
              <p className="text-ink">&ldquo;{r.skeptic.reading || 'No reading given.'}&rdquo;</p>
              <ul className="space-y-1.5">
                <Finding ok={!r.skeptic.negationRisk}>{r.skeptic.negationRisk ? 'A "not" may have been lost' : 'No sign of a lost "not"'}</Finding>
                <Finding ok={!r.skeptic.unsupported.length}>
                  {r.skeptic.unsupported.length ? `Would need unheard words: ${r.skeptic.unsupported.join(', ')}` : 'Needs no unheard words'}
                </Finding>
              </ul>
            </>
          ) : (
            <Absent>{whyNoModels(r)}</Absent>
          )}
        </Card>

        <Card title="Adjudicator" who="Not a model. Fixed rules, first match wins." explain="negation" wide>
          <p className="flex items-center gap-2 text-lg font-semibold text-ink">
            <a.Icon aria-hidden className={`h-5 w-5 ${a.tone}`} />
            {a.label}
          </p>
          <p className="text-sm text-ink">
            <span className="font-mono text-xs text-muted">Rule {d.policyRule}</span>{' '}
            {rule?.plain}
          </p>
          <ul className="space-y-1.5 border-t border-line pt-3">
            <Finding ok={!r.deterministic.negationDisputed}>
              {r.deterministic.negationDisputed ? 'Listeners disagree about a "not"' : 'Listeners agree on every "not"'}
            </Finding>
            <Finding ok={!r.deterministic.invented.length}>
              {r.deterministic.invented.length ? `Words never said: ${r.deterministic.invented.join(', ')}` : 'No invented words'}
            </Finding>
            <Finding ok={!r.deterministic.polarityMismatch}>
              {r.deterministic.polarityMismatch ? 'Yes and no were flipped' : 'Yes and no kept as heard'}
            </Finding>
          </ul>
        </Card>
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted">
        <span className="flex items-center gap-1.5"><Scale aria-hidden className="h-3.5 w-3.5" />decided in {r.timings.totalMs}ms</span>
        <span>{r.model ? `model: ${r.model}` : 'model calls: 0'}</span>
        {r.timings.advocateMs !== null && <span>advocate {r.timings.advocateMs}ms</span>}
        {r.timings.skepticMs !== null && <span>skeptic {r.timings.skepticMs}ms</span>}
        {d.action === 'ask' && (
          <span className="flex items-center gap-1.5"><ShieldAlert aria-hidden className="h-3.5 w-3.5" />nothing was said for the caller</span>
        )}
      </p>
    </section>
  );
}

function Heading() {
  return (
    <h3 id="dissent-h" className="flex items-center gap-2 text-base font-semibold text-ink">
      Two AIs argue. A rule decides.
      <Explain id="dissent" />
    </h3>
  );
}
