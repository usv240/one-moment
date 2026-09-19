// AUDIOBENCH on the evidence page: real disordered speech, through the live
// ears and the product's own engine. Rendered from eval/audiobench-decide.mjs
// output; never typed by hand.

import { Block, Code, Pre, Table } from '@/components/page';
import { Cite } from '@/components/cite';
import audiobench from '@/content/audiobench.json';
import { shownTranscript } from '@/lib/text';

type Arm = { spoke: number; wrong: number; invented: number; flipped: number; meanWer: number | null };
type Scored = { relayed: string | null; invented: string[]; inverted: boolean; wer: number | null; wrong: boolean };
type Row = {
  id: string; speaker: string; prompt: string; fastTurns: number; patientTurns: number;
  heard: { fast: string; patient: string };
  ordinary: Scored; patient: Scored; oneMoment: Scored & { action: string; rule: number };
};
type Result = {
  ranAt: string; model: string;
  summary: {
    sentences: number; speakers?: string[];
    ordinary?: Arm; patient?: Arm;
    oneMoment?: Arm & { asked: number; askedNeeded: number; askedUnneeded: number; modelCalls: number };
    turns?: { fastSplit: number; patientSplit: number; endedEarly: number; endedCap: number };
    wer?: { fast: number | null; patient: number | null; careful?: number | null };
    audit?: { graded: number; wrongRelays: number; wrongFlagged: number; rightRelays: number; rightFlagged: number };
  };
  rows: Row[];
};

export const audio = audiobench as unknown as Result;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : 'n/a');
const frac = (a: number, b: number) => (b ? `${a} of ${b}` : 'none spoken');
const w = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${Math.round(x * 100)}%`);

export function Audiobench() {
  const s = audio.summary;
  if (!s.ordinary || !s.patient || !s.oneMoment || !s.turns || !s.wer) return null;
  const n = s.sentences;
  const om = s.oneMoment;
  return (
    <Block id="audiobench" title="On real disordered speech">
      <p>
        Every number above this section comes from clean synthetic speech or text. This one does not. We streamed {n} read
        sentences from {s.speakers?.length ?? 'several'} speakers with dysarthria, from the TORGO database <Cite id="torgo" />,
        through both live AssemblyAI ears exactly as a call would, and then through the product&apos;s own engine. Each result is
        scored against the sentence the speaker was asked to read.
      </p>
      <Table
        caption="Real dysarthric speech: what each system would have said for the caller"
        head={['Listening and deciding', 'Spoke for the caller', 'Put words in their mouth or flipped the meaning', 'Word error rate of what it said']}
        rows={[
          [<b key="o">An ordinary agent</b>, frac(s.ordinary.spoke, n), `${frac(s.ordinary.wrong, s.ordinary.spoke)} (${pct(s.ordinary.wrong, s.ordinary.spoke)})`, w(s.ordinary.meanWer)],
          [<b key="p">Patient ear, no checks</b>, frac(s.patient.spoke, n), `${frac(s.patient.wrong, s.patient.spoke)} (${pct(s.patient.wrong, s.patient.spoke)})`, w(s.patient.meanWer)],
          [<b key="m">One Moment</b>, frac(om.spoke, n), `${frac(om.wrong, om.spoke)} (${pct(om.wrong, om.spoke)})`, w(om.meanWer)],
        ]}
      />
      <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
        <li>
          <b className="text-ink">The cost:</b> One Moment asked the caller instead of speaking on {frac(om.asked, n)} sentences. On {om.askedNeeded} of
          those, the ordinary agent&apos;s relay would have been wrong; {om.askedUnneeded} questions were not needed.
        </li>
        <li>
          <b className="text-ink">Turn-taking:</b> ordinary settings split {frac(s.turns.fastSplit, n)} sentences into more than one turn, each split a
          point where an ordinary agent would have started talking. The patient ear split {s.turns.patientSplit}.
        </li>
        <li>
          <b className="text-ink">Recognition itself is hard here:</b> word error rate {w(s.wer.fast)} for the ordinary ear and {w(s.wer.patient)} for the
          patient ear, against the prompt. We do not improve recognition; the point of the rules is what gets said anyway.
        </li>
        {s.audit && (
          <li>
            <b className="text-ink">The self-audit, on this speech:</b> AssemblyAI&apos;s pre-recorded model had a word error rate of {w(s.wer.careful)} here:
            about the same as the patient ear ({w(s.wer.patient)}), better than the ordinary one ({w(s.wer.fast)}). Of One Moment&apos;s {s.audit.wrongRelays} wrong relays it flagged {s.audit.wrongFlagged}
            {s.audit.wrongFlagged === 0 ? ', because it misheard the same words' : ''}, and it wrongly flagged {s.audit.rightFlagged} of {s.audit.rightRelays} correct
            ones. On disordered speech every model can make the same mistake; the audit catches the cases where the live ears guessed
            from context, as in the documented failure below, not errors all models share. It is a backstop, not an oracle.
          </li>
        )}
        <li>
          <b className="text-ink">What this is and is not:</b> dysarthria is a motor speech disorder, not aphasia. This tests the listening and decision
          layers on hard, real speech; it does not test word-finding. Speakers read prompts, so the prompt is the reference even
          where a speaker changed or repeated a word; some relays scored wrong here may be what the speaker actually said, which
          makes these error counts, if anything, too high for every arm alike. Run {audio.ranAt.slice(0, 10)}, model <Code>{audio.model}</Code>, {om.modelCalls} model calls.
        </li>
        <li>
          <b className="text-ink">Licence, and what is deliberately not in the repository:</b> TORGO is free for academic, non-profit use. We use it for
          non-commercial evaluation, publish only aggregate results and our own transcripts, and redistribute no audio. The audio
          and the raw per-sentence run output stay on the machine that ran it, by <Code>.gitignore</Code> and <Code>.vercelignore</Code>, so
          reproducing this means fetching TORGO yourself with the first command below. What ships is the aggregate above, every
          row in it, and the scripts that made both.
        </li>
      </ul>
      <details className="rounded-xl border border-line">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink">Every sentence ({audio.rows.length})</summary>
        <div className="border-t border-line p-3">
          <Table
            caption="AUDIOBENCH rows"
            head={['Asked to read', 'Ordinary agent would say', 'One Moment']}
            rows={audio.rows.map((r) => [
              <span key="p"><span className="font-mono text-xs text-muted">{r.speaker}</span> {r.prompt}</span>,
              `${r.ordinary.relayed ? shownTranscript(r.ordinary.relayed) : '(nothing)'}${r.ordinary.wrong ? '  [wrong]' : ''}`,
              r.oneMoment.relayed ? `${shownTranscript(r.oneMoment.relayed)}${r.oneMoment.wrong ? '  [wrong]' : ''}` : `asked (rule ${r.oneMoment.rule})`,
            ])}
          />
        </div>
      </details>
      <Pre>{`./eval/spike/scripts/fetch-torgo.sh      # TORGO, from the University of Toronto
node --env-file=.env eval/audiobench-stream.mjs --per-speaker 15
node --env-file=.env eval/audiobench-decide.mjs`}</Pre>
    </Block>
  );
}
