import type { Metadata } from 'next';
import Link from 'next/link';
import { Block, Code, Page, Pre, Table } from '@/components/page';
import { AUDIO, CALL, SPIKE } from '@/content/measured';

export const metadata: Metadata = {
  title: 'For judges',
  description: 'The three-minute path through One Moment, mapped to the judging criteria, with every claim linked to where you can check it.',
};

function Step({ n, title, href, children }: { n: number; title: string; href: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-line bg-raised p-5">
      <p className="font-mono text-sm text-muted">{n}</p>
      <Link href={href} className="mt-1 block text-lg font-semibold text-accent underline-offset-2 hover:underline">{title}</Link>
      <p className="mt-2 text-sm leading-relaxed text-ink">{children}</p>
    </li>
  );
}

export default function JudgesPage() {
  return (
    <Page
      eyebrow="For judges"
      title="The three-minute path"
      intro={
        <p>
          One Moment is a voice agent whose job is to make the other person wait, so people with aphasia can make their own
          phone calls. Here is the fastest way to see that it works, and to check that we are not overclaiming.
        </p>
      }
    >
      <Block id="path" title="Three steps">
        <ol className="grid gap-4 md:grid-cols-3">
          <Step n={1} title="Hear the two recorded calls (1 minute)" href="/replay">
            Real calls through the live system, replayed with their audio and every event they produced. In the first, the hold
            line is cut off the instant Robert finds his word. In the second, the medicine name only half comes out, and it asks.
          </Step>
          <Step n={2} title="Run one live (1 minute)" href="/demo">
            &ldquo;Play the recorded call&rdquo; drives the live engine with a recorded caller. Or use your microphone: start a
            sentence, stop for a few seconds, and let the simulated pharmacist try to talk over you.
          </Step>
          <Step n={3} title="Check one claim (1 minute)" href="/evidence">
            Every number links to the script that measured it. The benchmark shows the cases where we fail, not only the ones
            where we win.
          </Step>
        </ol>
      </Block>

      <Block id="criteria" title="Against the four criteria">
        <Table
          caption="Judging criteria"
          head={['Criterion', 'What to look at']}
          rows={[
            [
              <b key="a">Application of technology</b>,
              <span key="a2">
                Two concurrent Universal-Streaming sessions configured in opposite directions, their disagreement used as the
                uncertainty signal, and <Code>keyterms_prompt</Code> on one only, so the other can check a boosted word was really
                said. <Code>ForceEndpoint</Code> for semantic patience. A Voice Agent whose LLM is an endpoint that is not a model.
                The pre-recorded API grading every call afterwards. <Link className="text-accent underline underline-offset-2" href="/technology">Technology</Link>
              </span>,
            ],
            [
              <b key="b">Business value</b>,
              <span key="b2">
                Speech-to-Speech Relay is federally mandated and paid at $8.4822 a minute, and the FCC says it is under-used.
                One Moment costs two streaming sessions and one Voice Agent session a minute, and usually no model call. <Link className="text-accent underline underline-offset-2" href="/#who-pays">Who pays</Link>
              </span>,
            ],
            [
              <b key="c">Originality</b>,
              <span key="c2">
                Every voice agent is tuned to respond faster. This one is tuned to hold the floor for someone else, and to say
                nothing it was not given. The design is the published Supported Conversation technique, made into software. And it
                publishes its own failure: the one case no live check can catch, and how the self-audit caught it.
              </span>,
            ],
            [
              <b key="d">Presentation</b>,
              <span key="d2">
                Two views of one call: what the caller sees (three things on screen, no timers) and what is really happening.
                Light and dark, phone and desktop, an info button on every term, and our own <Link className="text-accent underline underline-offset-2" href="/accessibility">accessibility audit</Link>.
              </span>,
            ],
          ]}
        />
      </Block>

      <Block id="real" title="What is real, and what is simulated">
        <Table
          caption="Real versus simulated"
          head={['Part', 'In the demo']}
          rows={[
            ['Both AssemblyAI listening streams', 'Real, live, every call'],
            ['The AssemblyAI Voice Agent speaking to the far party', 'Real, live, every call'],
            ['The Floor Controller, Dissent and the Adjudicator', 'Real, live, every call'],
            ['The caller in "Play the recorded call"', 'A computer voice with an exactly known 6-second pause'],
            ['The pharmacist', 'A computer voice that speaks when the caller goes quiet'],
            ['The caller in "Use my microphone"', 'You'],
          ]}
        />
      </Block>

      <Block id="numbers" title="The numbers, briefly">
        <ul className="list-disc space-y-2 pl-5">
          <li>Same recording, {(SPIKE.pauseMs / 1000).toFixed(1)}-second pause: default settings made {SPIKE.defaultTurns} turns of one sentence; the patient ear made {SPIKE.patientTurns}.</li>
          <li>The live transcript hides that pause as {SPIKE.realtimeGapMs}ms gaps. Word durations recover {SPIKE.recoveredMs}ms of the {SPIKE.actualMs}ms.</li>
          <li>On the recorded call, the sentence was relayed in the caller&apos;s own words with {CALL.modelCalls === 0 ? 'zero model calls' : 'model calls'}.</li>
          <li>The benchmark, on the product&apos;s own engine, with the failures included: <Link className="text-accent underline underline-offset-2" href="/evidence#negbench">NEGBENCH</Link>.</li>
          {AUDIO && (
            <li>
              On {AUDIO.sentences} real recorded sentences from {AUDIO.speakers} speakers with dysarthria (TORGO): an ordinary agent would have relayed
              something wrong in {AUDIO.ordinary.wrong} of {AUDIO.ordinary.spoke}; One Moment in {AUDIO.oneMoment.wrong} of the {AUDIO.oneMoment.spoke} it spoke, asking on
              the rest. Ordinary settings split {AUDIO.turns.fastSplit} sentences mid-way; the patient ear split {AUDIO.turns.patientSplit}.{' '}
              <Link className="text-accent underline underline-offset-2" href="/evidence#audiobench">AUDIOBENCH</Link>.
            </li>
          )}
        </ul>
      </Block>

      <Block id="run" title="Run it yourself">
        <Pre>{`cd one-moment && npm install
cp .env.example .env     # your AssemblyAI key
npm test                 # the engine: floor, evidence, Dissent, rule 11, semantic patience
npm run orchestrator     # opens a public tunnel so the Voice Agent can reach it
npm run web              # http://localhost:3000/demo`}</Pre>
        <p className="text-sm text-muted">MIT licensed. Built for the AssemblyAI Voice Agent Hackathon, September 2026. Not a medical device.</p>
      </Block>
    </Page>
  );
}
