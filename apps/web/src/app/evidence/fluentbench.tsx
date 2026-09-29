// The fair objection, measured: does a system tuned for patience get in the way
// of everyone else?
//
// Every other number on this page is about disordered speech, where waiting
// longer is obviously right. The opposite worry is the one a sceptical judge
// should have: a relay that waits six seconds and asks whenever it is unsure
// could be unusable for a fluent speaker. If that were true the design would be
// wrong, not merely narrow.
//
// So this runs ordinary, fluent, clean human speech from a corpus we did not
// record, through the same two ears, the same end-of-turn rules and the same
// engine. Rendered from eval/fluentbench-decide.mjs; never typed by hand.

import { Block, Code, Pre, Table } from '@/components/page';
import { Cite } from '@/components/cite';
import fluent from '@/content/fluentbench.json';

type Result = {
  ranAt: string; corpus: string;
  summary: {
    sentences: number; speakers?: number; relayed?: number; asked?: number; wrong?: number;
    verbatim?: number; modelCalls?: number;
    turns?: { patientSplit: number; fastSplit: number; endedEarly: number; endedNatural: number; endedCap: number };
    waited?: { meanMs: number; medianMs: number; underTwoSeconds: number };
    wer?: { patient: number | null; fast: number | null };
  };
};

export const fluentb = fluent as unknown as Result;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : 'n/a');
const w = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${Math.round(x * 100)}%`);

export function Fluentbench() {
  const s = fluentb.summary;
  if (!s.turns || !s.waited || !s.wer || s.relayed === undefined || s.asked === undefined) return null;
  const n = s.sentences;
  return (
    <Block id="fluent" title="And does it get in the way of everyone else?">
      <p>
        Everything above is about disordered speech, where waiting longer is obviously the right thing to do. The fair
        objection is the opposite one: a relay that holds a turn for six seconds and asks whenever it is unsure might be
        unusable for a speaker with no difficulty at all. If that were true, the design would be wrong rather than narrow. So
        we ran {n} sentences of ordinary fluent speech from {s.speakers} readers, taken from LibriSpeech <Cite id="libri" />,
        through the same two ears, the same end-of-turn rules and the same engine.
      </p>
      <Table
        caption="Fluent speech, through the patient system"
        head={['Measured', 'Result']}
        rows={[
          [<b key="a">It spoke rather than asked</b>, `${s.relayed} of ${n} (${pct(s.relayed, n)}), of which ${s.verbatim ?? 0} took the verbatim path and used no model at all`],
          [<b key="b">It put words in a fluent speaker&apos;s mouth</b>, `${s.wrong ?? 0} of ${s.relayed}`],
          [<b key="c">How long it waited after they stopped</b>, `${(s.waited.medianMs / 1000).toFixed(1)}s median, ${(s.waited.meanMs / 1000).toFixed(1)}s mean. ${s.waited.underTwoSeconds} of ${n} ended in under two seconds`],
          ['The patient ear split the sentence', `${s.turns.patientSplit} of ${n}`],
          ['Ordinary settings split the sentence', `${s.turns.fastSplit} of ${n}`],
          ['Word error rate, patient ear against the read sentence', w(s.wer.patient)],
        ]}
      />
      <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
        <li>
          <b className="text-ink">Patience is not the same as lag.</b> The six-second window is a ceiling, not a wait. When both
          ears agree a sentence has finished, <Code>ForceEndpoint</Code> ends the turn about a second and a half later, which is
          why the median here is {(s.waited.medianMs / 1000).toFixed(1)} seconds and {s.waited.underTwoSeconds} of {n} turns ended
          in under two. A fluent speaker pays for the patience only when they actually pause.
        </li>
        <li>
          <b className="text-ink">The {s.wrong} flagged relays are worth reading, because none of them is an invention.</b> Every
          word the scorer objected to was in what the ears actually heard, so the engine added nothing. Most are the corpus and
          the recogniser disagreeing about spelling rather than mistakes a listener would notice: LibriSpeech writes
          &ldquo;MARCH TWENTY SECOND EIGHTEEN THIRTY SEVEN&rdquo; where AssemblyAI heard &ldquo;March 22nd, 1837&rdquo;,
          and &ldquo;ENQUIRIES&rdquo; where it heard &ldquo;inquiries&rdquo;. The genuine ones are misheard names, such as
          &ldquo;Emil&rdquo; heard as &ldquo;Amiel&rdquo;, which the verbatim path passes on faithfully. We do not improve
          recognition and have never claimed to; this is what that costs on clean speech.
        </li>
        <li>
          <b className="text-ink">The cost of caution, on people who do not need it.</b> {s.asked} of {n} became a question
          rather than a relay. On clean speech that is the system being careful about nothing, and it is the honest price of a
          design that would rather ask than guess.
        </li>
        <li>
          <b className="text-ink">Even here, ordinary settings cut people off.</b> The fast ear split {s.turns.fastSplit} of {n}{' '}
          fluent, unimpaired sentences into more than one turn. The patient ear split {s.turns.patientSplit}.
        </li>
        <li>
          <b className="text-ink">Corpus:</b> LibriSpeech test-clean, read speech from public-domain audiobooks, CC BY 4.0, with
          the sentence each speaker read as the reference. We did not record it and did not choose which sentences exist in it.
          Run {fluentb.ranAt.slice(0, 10)}, {s.modelCalls ?? 0} model calls across {n} sentences, because {s.verbatim ?? 0} of
          them needed no model at all.
        </li>
      </ul>
      <Pre>{`node --env-file=.env eval/fluentbench.mjs --n ${n}
node --env-file=.env eval/fluentbench-decide.mjs`}</Pre>
    </Block>
  );
}
