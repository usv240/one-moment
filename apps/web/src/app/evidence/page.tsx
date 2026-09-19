import type { Metadata } from 'next';
import Link from 'next/link';
import { Block, Code, Page, Pre, Table } from '@/components/page';
import { CITATIONS, type Group } from '@/content/citations';
import { CALL, SPIKE, VOCABULARY } from '@/content/measured';
import negbench from '@/content/negbench.json';
import verify from '@/content/verify.json';
import failure from '@/content/failure-agreeing-ears.json';
import { shownTranscript } from '@/lib/text';
import { audio, Audiobench } from './audiobench';

export const metadata: Metadata = {
  title: 'Evidence',
  description: 'Every number One Moment shows, where it came from, and how to reproduce it. Plus the research it rests on.',
};

type Arm = { n: number; relayed: number; asked: number; withInventedWords: number; negationCasesRelayed: number; negationFlipped: number };
type Bench = {
  ranAt: string; engine: string; source: string; degradation: string; model: string; seed: number; cases: number;
  conditions: string[]; byCondition: Record<string, { baseline: Arm; full: Arm; overAsked: number }>;
  rows: { groundTruth: string; condition: string; baselineHeard: string; hasNegation: boolean;
    baseline: { relayed: string | null; invented: string[]; inverted: boolean; refused: boolean };
    full: { relayed: string | null; invented: string[]; inverted: boolean; refused: boolean; rule: number; advocate?: string | null; blockedWords?: string[] } }[];
};
const bench = negbench as unknown as Bench;

const CONDITION_LABEL: Record<string, string> = {
  clean: 'Clear speech',
  'one-ear': 'A word lost by one listening stream',
  'both-ears': 'A word lost by both streams',
};

function frac(a: number, b: number) {
  return b ? `${a} of ${b}` : 'none spoken';
}

type Verification = { ranAt: string; ok: boolean; tests: { total: number; pass: number; fail: number } | null; checks: { name: string; ok: boolean; detail: string }[] };
const verified = verify as Verification;

/**
 * The check on us, rendered from the checker's own output.
 *
 * Every number on this page is computed from a committed run file, so the risk
 * is not a typo, it is the run file quietly changing. npm run verify scores
 * every relay again from scratch against ground truth we did not write, rebuilds
 * the totals from those fresh scores, and fails if they differ from what you are
 * reading. This section renders that run, so the page cannot claim a check that
 * did not happen, or hide one that failed.
 */
function Verify() {
  return (
    <Block id="verify" title={verified.ok ? `Check it yourself: ${verified.checks.length} of ${verified.checks.length} checks pass` : 'Check it yourself: a check is failing'}>
      <p>
        Every figure above is derived from a run file in the repository rather than typed into the page. So the question is
        not whether we made a typo, it is whether those files still say what we claim. <Code>npm run verify</Code> scores
        every relay in both benchmarks again from scratch, against ground truth we did not write, rebuilds the totals from
        those fresh scores, and exits non-zero if anything differs. This table is that command&apos;s output, not a summary
        of it.
      </p>
      <Table
        caption="Verification checks"
        head={['Check', 'Result', 'What it found']}
        rows={verified.checks.map((c) => [c.name, c.ok ? 'pass' : 'FAIL', c.detail])}
      />
      <p className="text-sm text-muted">
        Run {verified.ranAt.slice(0, 10)}
        {verified.tests ? `, with ${verified.tests.pass} of ${verified.tests.total} engine tests passing` : ''}. One of the
        checks asserts that the unflattering numbers are still there, so a future run cannot quietly drop them.
      </p>
    </Block>
  );
}

function Negbench() {
  const conds = bench.conditions.filter((c) => bench.byCondition[c]);
  // One real block from this run, if there was one: a model proposed a word nobody said.
  const block = bench.rows.find((r) => r.full.refused && r.full.advocate && (r.full.blockedWords?.length ?? 0) > 0);
  return (
    <Block id="negbench" title="Does it speak words the person never said?">
      <p>
        The same model, the same input, two ways of using it. The <b>baseline</b> is one model asked to say what the person meant,
        the way most assistants work. <b>One Moment</b> is the product&apos;s own decision engine, exactly as a live call runs it.
        A sentence counts as having invented words if it contains a content word the speaker never said.
      </p>
      <Table
        caption="NEGBENCH results by condition"
        head={['Condition', 'Arm', 'Spoke for the caller', 'With invented words', 'Flipped a "not"', 'Asked the caller instead']}
        rows={conds.flatMap((c) => {
          const r = bench.byCondition[c]!;
          return [
            [<b key="c">{CONDITION_LABEL[c] ?? c}</b>, 'Baseline', frac(r.baseline.relayed, r.baseline.n), frac(r.baseline.withInventedWords, r.baseline.relayed), frac(r.baseline.negationFlipped, r.baseline.negationCasesRelayed), frac(r.baseline.asked, r.baseline.n)],
            ['', <b key="o">One Moment</b>, frac(r.full.relayed, r.full.n), frac(r.full.withInventedWords, r.full.relayed), frac(r.full.negationFlipped, r.full.negationCasesRelayed), `${frac(r.full.asked, r.full.n)}${r.overAsked ? ` (${r.overAsked} not needed)` : ''}`],
          ];
        })}
      />
      <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
        <li>
          <b className="text-ink">Sample:</b> {bench.cases} sentences from the {bench.source}, run {bench.ranAt.slice(0, 10)} with{' '}
          <Code>{bench.model}</Code>, seed {bench.seed}. Small. Read it as a direction, not a rate.
        </li>
        <li><b className="text-ink">What we wrote:</b> the degradation, in {bench.degradation}. We did not write the sentences or their meaning.</li>
        <li>
          <b className="text-ink">Text level:</b> this measures the decision layer, not recognition. Clear-speech confidences are 0.90 to 0.99; degraded ones
          are drawn low, as disordered speech would be.
        </li>
        <li>
          <b className="text-ink">The honest limit:</b> when both listening streams lose the same &ldquo;not&rdquo;, the text no longer contains it, and
          no check on the text can recover it. That row is published so you can see the size of it.
        </li>
        <li>&ldquo;Not needed&rdquo; counts questions asked where the baseline&apos;s plain reading was in fact correct: the cost of caution.</li>
      </ul>
      {block && (
        <div className="rounded-xl border border-line bg-raised p-4">
          <p className="text-sm font-semibold text-ink">One real block from this run</p>
          <p className="mt-2 text-sm text-ink">
            Said: &ldquo;{block.groundTruth}&rdquo;. The Advocate proposed: &ldquo;{block.full.advocate}&rdquo;. Rule 2 blocked it,
            because &ldquo;{block.full.blockedWords?.join(', ')}&rdquo; was never said, and asked instead.
            {/amlodipine/i.test(block.full.advocate ?? '') && !/amlodipine/i.test(block.groundTruth) ? ' The small model had repeated the example sentence from its own instructions.' : ''}
            {' '}That is exactly why the decision is made by code, not by a model.
          </p>
        </div>
      )}
      <details className="rounded-xl border border-line">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink">Every case, both arms ({bench.rows.length} rows)</summary>
        <div className="border-t border-line p-3">
          <Table
            caption="NEGBENCH rows"
            head={['Said', 'Condition', 'Baseline said', 'One Moment']}
            rows={bench.rows.map((r) => [
              r.groundTruth,
              CONDITION_LABEL[r.condition] ?? r.condition,
              r.baseline.relayed ? `${r.baseline.relayed}${r.baseline.invented.length ? `  [invented: ${r.baseline.invented.join(', ')}]` : ''}${r.baseline.inverted ? '  [meaning flipped]' : ''}` : '(nothing)',
              r.full.relayed ? `${r.full.relayed}${r.full.invented.length ? `  [invented: ${r.full.invented.join(', ')}]` : ''}${r.full.inverted ? '  [meaning flipped]' : ''}` : `asked (rule ${r.full.rule})`,
            ])}
          />
        </div>
      </details>
      <Pre>{`npm install
node --env-file=.env eval/negbench.mjs --n ${bench.cases} --seed ${bench.seed}`}</Pre>
    </Block>
  );
}

const GROUPS: Group[] = ['Turn-taking', 'Aphasia and partner training', 'Speech recognition and AI', 'Relay services and regulation', 'Design and accessibility'];

export default function EvidencePage() {
  return (
    <Page
      eyebrow="Evidence"
      title="Every number, and where it came from"
      intro={<p>Measured numbers are ours and say how they were measured. Everything else is cited. Nothing on this site is a target typed as if it were a result.</p>}
    >
      <Block id="api" title="Measured against the live AssemblyAI API">
        <Table
          caption="Live API measurements"
          head={['Measurement', 'Result', 'How']}
          rows={[
            [`Turns produced for one sentence with a ${(SPIKE.pauseMs / 1000).toFixed(1)}s pause`, `${SPIKE.defaultTurns} with defaults, ${SPIKE.patientTurns} with the patient ear`, <Code key="a">eval/spike/tests/02-patience.js</Code>],
            ['Inter-word gap reported across that pause', `${SPIKE.realtimeGapMs}ms`, <Code key="b">eval/spike/tests/04-confidence.js</Code>],
            ['Hidden pause recovered from word durations', `${SPIKE.recoveredMs}ms of ${SPIKE.actualMs}ms`, <Code key="c">packages/core/test/evidence.test.ts</Code>],
            ['Latency cost of the second listening stream', `${SPIKE.secondStreamMs}ms`, <Code key="d">eval/spike/tests/01-dual-stream.js</Code>],
            ['Voice Agent with our endpoint as its LLM', 'Speaks our text word for word; silent when we return nothing', <Code key="e">eval/proofs/voice-agent-verbatim.mjs</Code>],
            ['Recorded demo call: hold line when the caller resumed', CALL.holdCut ? 'Cut off by the orchestrator' : 'Not cut', <Code key="f">apps/orchestrator/scripts/record-sample-call.ts</Code>],
            ...(CALL.audit ? [[
              'Recorded demo call: the pause, after the call',
              `${CALL.audit.pause.carefulMs}ms heard by the pre-recorded model; ${CALL.audit.pause.liveGapMs}ms longest live gap; ${CALL.audit.pause.estimatedMs}ms our estimate`,
              <Code key="h">apps/orchestrator/src/audit.ts</Code>,
            ], [
              'Recorded demo call: relayed words confirmed by the careful transcript',
              CALL.audit.allConfirmed ? 'All of them' : 'Not all',
              <Code key="i">apps/orchestrator/src/audit.ts</Code>,
            ]] : []),
            ['Recorded demo call: model calls to relay the sentence', CALL.modelCalls === 0 ? '0 (rule 9, verbatim)' : 'see log', <Code key="g">apps/web/src/content/recorded-call.json</Code>],
          ]}
        />
        <p className="text-sm text-muted">
          Measured 17 and 18 September 2026 on synthetic speech with an exactly known pause, so the ground truth is certain. Real
          disordered speech will be harder for recognition, which is why the design never relies on recognition being right.
        </p>
      </Block>

      {/* A smoke run is not a result. The section appears only with a real sample. */}
      {bench.cases >= 10 && <Negbench />}
      {audio.summary.sentences >= 30 && <Audiobench />}

      <Block id="vocabulary" title="Your words, double-checked">
        <p>
          The patient ear is told the caller&apos;s own words, so it hears them more easily. That is also the danger: a word it
          is listening for can be heard because it was expected. We tested it with four slurred ways of saying a medicine.
        </p>
        <Table
          caption="Vocabulary probe"
          head={['Said', 'Ear told the caller\'s words', 'Ear not told']}
          rows={VOCABULARY.examples.map((e) => [<span key="s" className="font-mono">{e.said}</span>, e.boosted, e.unbiased])}
        />
        <p>
          The boosted ear produced &ldquo;amlodipine&rdquo; {VOCABULARY.boostedHeardTerm} times out of {VOCABULARY.variants}; the
          unbiased ear, {VOCABULARY.unbiasedHeardTerm}. So rule 11: a word from the caller&apos;s list that only the listening-for-it
          ear heard, or that only partly came out, is offered as a choice (&ldquo;Amlodipine, or metformin?&rdquo;) and never
          relayed on trust. Measured {'18 September 2026'} with <Code>eval/probe-vocabulary.mjs</Code>.
        </p>
      </Block>

      <Block id="failure" title="A failure the live checks missed, and the audit caught">
        <p>
          We publish this one on purpose. In an earlier run of the harder call, the caller said &ldquo;{failure.said}&rdquo; In
          context, <b>both</b> live ears wrote &ldquo;amlodipine&rdquo;, so they agreed, no rule fired, and it was relayed.
        </p>
        <Table
          caption="The failure"
          head={['Source', 'What it had']}
          rows={[
            ['Patient ear (live)', failure.patient.map(shownTranscript).join(' ')],
            ['Fast ear (live)', failure.fast.map(shownTranscript).join(' ')],
            ['Relayed to the pharmacist', failure.relayed.join(' ')],
            [`Careful transcript after the call (${failure.carefulModel})`, shownTranscript(failure.careful)],
            ['Self-audit verdict', failure.verdict],
          ]}
        />
        <p>
          When both ears are wrong the same way, no live check can know. The self-audit can, because the pre-recorded model
          listens more carefully and was not told what to expect. This is why every call is graded afterwards, and why the
          product is positioned as a first line with a human behind it.
        </p>
      </Block>

      <Verify />

      <Block id="reproduce" title="Reproduce it">
        <Pre>{`git clone <this repository>
cd one-moment && npm install
npm run verify                   # re-derives every number above from the committed runs
cp .env.example .env            # add your AssemblyAI key
npm test                         # the engine: floor, evidence, Dissent, semantic patience
node --env-file=.env apps/orchestrator/scripts/record-sample-call.ts   # a full call, recorded
node --env-file=.env eval/negbench.mjs --n 16 --seed 11                # the benchmark`}</Pre>
      </Block>

      <Block id="research" title="The research it rests on">
        <p>
          The central inference, stated with its limit: the best-evidenced help for aphasia in conversation is a trained
          partner, and the partner on a phone call cannot be trained. No study has tested an automated partner. This is an
          untested application of a well-evidenced principle.
        </p>
        {GROUPS.map((g) => (
          <div key={g}>
            <h3 className="mt-6 text-sm font-semibold uppercase tracking-wider text-muted">{g}</h3>
            <ul className="mt-2 space-y-2">
              {CITATIONS.filter((c) => c.group === g).map((c) => (
                <li key={c.id} className="text-sm">
                  <a href={c.href} target="_blank" rel="noreferrer" className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent">{c.full}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-sm text-muted">
          Our own accessibility audit is on the <Link href="/accessibility" className="text-accent underline underline-offset-2">accessibility page</Link>.
        </p>
      </Block>
    </Page>
  );
}
