'use client';

// "Listening twice."
//
// Two AssemblyAI streams hear the same microphone. The fast ear uses ordinary
// settings and ends a turn at the first pause, the way every voice agent does.
// The patient ear waits. Showing both, side by side, makes the problem visible:
// each block on the fast side is a place a normal agent would have taken the
// floor from the caller mid-sentence.

import type { StreamTurn } from '@one-moment/core';
import { Scissors } from 'lucide-react';
import { Explain } from '../explain';
import { shownTranscript } from '@/lib/text';

const shown = shownTranscript;

type Props = {
  patientTurns: StreamTurn[];
  fastTurns: StreamTurn[];
  partial: { patient: string; fast: string };
};

function Ear({ name, settings, explain, turns, partial, cuts }: {
  name: string; settings: string; explain: string; turns: StreamTurn[]; partial: string; cuts?: boolean[];
}) {
  const from = Math.max(0, turns.length - 6);
  const visible = turns.slice(from);
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-raised p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">{name}</p>
          <p className="font-mono text-xs text-muted">{settings}</p>
        </div>
        <Explain id={explain} />
      </div>
      <ol className="flex flex-col gap-2" aria-label={`${name}: finished turns`}>
        {visible.map((t, i) => (
          <li key={`${t.turn_order}-${i}`} className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink">
            {cuts?.[from + i] && (
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
                <Scissors aria-hidden className="h-3.5 w-3.5" />
                A normal agent would have started talking here
              </span>
            )}
            {shown(t.transcript) || <span className="text-muted">(silence)</span>}
          </li>
        ))}
        {partial && (
          <li className="rounded-lg border border-dashed border-line-strong px-3 py-2 text-sm text-muted">
            {shown(partial)}
            <span className="sr-only"> (still listening)</span>
          </li>
        )}
        {!visible.length && !partial && <li className="text-sm text-muted">Waiting for speech.</li>}
      </ol>
      <p className="mt-auto font-mono text-xs text-muted">
        turns ended: <span className="font-semibold text-ink">{turns.length}</span>
      </p>
    </div>
  );
}

const span = (t: StreamTurn): [number, number] | null =>
  t.words.length ? [t.words[0]!.start, t.words[t.words.length - 1]!.end] : null;

/**
 * A fast turn is a cut only if it ended inside what the patient ear kept as one
 * sentence. Two fast turns for two genuinely separate sentences are not a cut.
 * Both sessions open together on one microphone, so their word times line up.
 */
function cutFlags(fast: StreamTurn[], patient: StreamTurn[], slackMs = 500): boolean[] {
  const groupOf = (f: StreamTurn): number => {
    const s = span(f);
    if (!s) return -1;
    const i = patient.findIndex((p) => {
      const ps = span(p);
      return ps !== null && s[0] >= ps[0] - slackMs && s[0] <= ps[1] + slackMs;
    });
    return i === -1 ? patient.length : i;
  };
  let prev: number | null = null;
  return fast.map((f) => {
    const g = groupOf(f);
    const cut = g === prev && g !== -1;
    prev = g;
    return cut;
  });
}

export function ListeningTwice({ patientTurns, fastTurns, partial }: Props) {
  // A fast final with no words is not a cut anyone would hear.
  const fast = fastTurns.filter((t) => t.transcript.trim());
  const cuts = cutFlags(fast, patientTurns);
  const cutCount = cuts.filter(Boolean).length;
  return (
    <section aria-labelledby="twice-h" className="space-y-3">
      <h3 id="twice-h" className="flex items-center gap-2 text-base font-semibold text-ink">
        Listening twice
        <Explain id="two-streams" />
      </h3>
      <p className="text-sm text-muted">
        Same microphone, two AssemblyAI streams. The fast ear is set up like an ordinary voice agent.
        {cutCount > 0 && <> So far it would have interrupted the caller <span className="font-semibold text-ink">{cutCount === 1 ? 'once' : `${cutCount} times`}</span> mid-sentence.</>}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <Ear name="Patient ear" settings="max_accuracy, waits up to 9s" explain="patient-stream" turns={patientTurns} partial={partial.patient} />
        <Ear name="Fast ear" settings="min_latency, default pauses" explain="fast-stream" turns={fast} partial={partial.fast} cuts={cuts} />
      </div>
    </section>
  );
}
