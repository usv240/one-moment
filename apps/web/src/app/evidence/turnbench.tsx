// What the turn-detection setting costs the person speaking.
//
// You can characterise endpointing by sweeping its parameters against synthetic
// speech, and that tells you when a turn fires. It cannot tell you what firing
// costs, because a synthetic voice never stops mid-word to look for one. So this
// sweeps the same setting across real disordered speech and scores each value by
// what the speaker loses. Rendered from eval/turnbench-summarise.mjs.

import { Block, Code, Pre, Table } from '@/components/page';
import { Cite } from '@/components/cite';
import turn from '@/content/turnbench.json';

type Setting = {
  label: string; minTurnSilence: number | null; sentences: number;
  split: number; firedDuringSpeech: number; lostWordsTotal: number; saidWordsTotal: number;
  sentencesLosingWords: number; waitedMedianMs: number | null; waitedMeanMs: number | null;
};
type Result = { ranAt: string; corpus: string; note: string; sentences: number; speakers: number; settings: Setting[] };

export const turnb = turn as unknown as Result;

export function Turnbench() {
  const s = turnb.settings ?? [];
  if (s.length < 2) return null;
  const vendor = s[0]!;
  const ours = s[s.length - 1]!;
  const mid = s.find((x) => x.minTurnSilence === 2400);
  return (
    <Block id="turnbench" title="What the turn setting costs the person speaking">
      <p>
        One setting decides whether a sentence survives: <Code>min_turn_silence</Code>. It can be characterised by sweeping it
        against synthetic speech, and that tells you when a turn fires. It cannot tell you what firing costs, because a
        synthetic voice never stops in the middle of a word to look for one. So we swept it across {turnb.sentences} sentences
        from {turnb.speakers} speakers with dysarthria <Cite id="torgo" /> and scored each value by what the speaker loses.
      </p>
      <Table
        caption="One ear, one setting at a time, on real disordered speech"
        head={['min_turn_silence', 'Turn closed while they were still speaking', 'Sentences cut into more than one turn', 'Words still to come when the turn closed', 'Median wait after they stopped']}
        rows={s.map((x) => [
          <b key={x.label}>{x.label}</b>,
          `${x.firedDuringSpeech} of ${x.sentences}`,
          `${x.split} of ${x.sentences}`,
          `${x.lostWordsTotal} of ${x.saidWordsTotal}`,
          x.waitedMedianMs === null ? 'n/a' : `${(x.waitedMedianMs / 1000).toFixed(1)}s`,
        ])}
      />
      <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
        <li>
          <b className="text-ink">At the vendor default, the turn closes while the person is still talking.</b> It did so on{' '}
          {vendor.firedDuringSpeech} of {vendor.sentences} sentences, with {vendor.lostWordsTotal} words of{' '}
          {vendor.saidWordsTotal} still to come. A voice agent on those settings is not waiting for a pause; it is answering
          before the sentence exists.
        </li>
        {mid && (
          <li>
            <b className="text-ink">And here is the result that argues against our own setting.</b> At {mid.label} nothing fired
            early, nothing split, and only {mid.lostWordsTotal} words were lost: the same as ours, for{' '}
            {(((ours.waitedMedianMs ?? 0) - (mid.waitedMedianMs ?? 0)) / 1000).toFixed(1)} seconds less waiting. On this corpus,
            6000ms buys nothing that 2400ms has not already bought.
          </li>
        )}
        <li>
          <b className="text-ink">Why we kept 6000 anyway, stated so you can disagree.</b> TORGO is read speech: the pauses are
          short, so a 2400ms setting is enough to clear them. The pause this product exists for is a word-finding block in
          aphasia, which the literature puts at roughly 5 to 10 seconds, and no corpus of dysarthric read speech can show it.
          The 6000ms value is a ceiling for that case, not a delay we pay on every turn: when both ears agree a sentence has
          finished, <Code>ForceEndpoint</Code> closes it early, which is why the median wait on fluent speech measured 1.7
          seconds rather than six.
        </li>
        <li>
          <b className="text-ink">What this measures, and what it does not.</b> {turnb.note} Twelve sentences is a small sample
          and is reported as one. Run {turnb.ranAt.slice(0, 10)}.
        </li>
      </ul>
      <Pre>{`node --env-file=.env eval/turnbench.mjs --n ${turnb.sentences}
node eval/turnbench-summarise.mjs`}</Pre>
    </Block>
  );
}
