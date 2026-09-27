// The same 120 sentences, over a telephone line.
//
// Every other number on this site comes from 16kHz audio, which is what a
// browser microphone gives. A phone gives 8kHz mu-law: band-limited to about
// 3.4kHz and logarithmically companded, which throws away the high frequency
// detail that separates fricatives and stops, the consonants disordered speech
// is already least reliable on. So "it works" measured on a laptop is not
// evidence that it works on the thing it is actually for.
//
// This run holds everything else identical to the wideband one: same sentences,
// same seed, same two ear configurations, same end-of-turn rules, same engine.
// Audio quality is the only variable. Rendered from eval/audiobench-decide.mjs
// --arm 8k; never typed by hand.

import { Block, Code, Pre, Table } from '@/components/page';
import { Cite } from '@/components/cite';
import narrowband from '@/content/audiobench-8k.json';
import { audio } from './audiobench';

type Arm = { spoke: number; wrong: number; meanWer: number | null };
type Result = {
  ranAt: string; model: string;
  summary: {
    sentences: number; speakers?: string[];
    ordinary?: Arm; patient?: Arm;
    oneMoment?: Arm & { asked: number; askedNeeded: number; askedUnneeded: number };
    turns?: { fastSplit: number; patientSplit: number };
    wer?: { fast: number | null; patient: number | null };
  };
};

export const narrow = narrowband as unknown as Result;
const w = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${Math.round(x * 100)}%`);
const frac = (a: number, b: number) => `${a} of ${b}`;
/** How much worse, in points of word error rate. */
const delta = (a: number | null | undefined, b: number | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined ? '' : ` (${b > a ? '+' : ''}${Math.round((b - a) * 100)})`;

export function Narrowband() {
  const s = narrow.summary;
  const wide = audio.summary;
  if (!s.ordinary || !s.patient || !s.oneMoment || !s.turns || !s.wer) return null;
  if (!wide.ordinary || !wide.oneMoment || !wide.turns || !wide.wer) return null;
  const n = s.sentences;
  return (
    <Block id="narrowband" title="The same sentences, over a telephone line">
      <p>
        Everything above this section was measured at 16kHz, which is what a browser microphone gives. A phone line gives 8kHz
        mu-law: band-limited to about 3.4kHz and logarithmically companded, which discards exactly the high frequency detail
        that separates one consonant from another. Since the product is for phone calls, measuring it only on laptop audio
        would be measuring the easy case. So the same {n} TORGO sentences <Cite id="torgo" /> were streamed again through the
        same two ears, with the audio put through a real telephone encoder first and nothing else changed.
      </p>
      <Table
        caption="Wideband against telephone quality, same sentences, same engine"
        head={['Measured', 'At 16kHz', 'Over a phone line']}
        rows={[
          ['Ordinary ear, word error rate', w(wide.wer.fast), `${w(s.wer.fast)}${delta(wide.wer.fast, s.wer.fast)}`],
          ['Patient ear, word error rate', w(wide.wer.patient), `${w(s.wer.patient)}${delta(wide.wer.patient, s.wer.patient)}`],
          [<b key="a">Ordinary settings split the sentence</b>, frac(wide.turns.fastSplit, wide.sentences), frac(s.turns.fastSplit, n)],
          [<b key="b">The patient ear split the sentence</b>, frac(wide.turns.patientSplit, wide.sentences), frac(s.turns.patientSplit, n)],
          ['An ordinary agent put words in their mouth', frac(wide.ordinary.wrong, wide.ordinary.spoke), frac(s.ordinary.wrong, s.ordinary.spoke)],
          ['Patient ear, no checks, did', frac(wide.patient?.wrong ?? 0, wide.patient?.spoke ?? 0), frac(s.patient.wrong, s.patient.spoke)],
          [<b key="c">One Moment did</b>, frac(wide.oneMoment.wrong, wide.oneMoment.spoke), frac(s.oneMoment.wrong, s.oneMoment.spoke)],
          ['One Moment asked instead of speaking', frac(wide.oneMoment.asked, wide.sentences), frac(s.oneMoment.asked, n)],
        ]}
      />
      <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
        <li>
          <b className="text-ink">Recognition gets worse, and the turn-taking result does not move.</b> Both ears lose about four
          points of word error rate to the phone line, which is the honest cost of narrowband audio on speech that is already
          hard. But ordinary settings still cut {s.turns.fastSplit} of {n} sentences off mid-way, and the patient ear still cuts{' '}
          {s.turns.patientSplit}. The central claim of this project is about when a turn ends, not about how well anything is
          heard, and that is why it survives the transcoding intact.
        </li>
        <li>
          <b className="text-ink">Why this run exists.</b> Until it, the honest line on the limits page was that telephone audio
          was unmeasured, so nothing about phone calls was claimed. A product whose entire premise is a phone call cannot
          leave that unmeasured and still expect to be believed.
        </li>
        <li>
          <b className="text-ink">What is not repeated here.</b> The post-call self-audit is not re-run on this arm, so the audit
          numbers above are wideband only. Run {narrow.ranAt.slice(0, 10)}, model <Code>{narrow.model}</Code>.
        </li>
      </ul>
      <Pre>{`node --env-file=.env eval/audiobench-stream.mjs --narrowband --out eval/results/audiobench-evidence-8k.json
node --env-file=.env eval/audiobench-decide.mjs --arm 8k`}</Pre>
    </Block>
  );
}
