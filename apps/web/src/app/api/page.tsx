import type { Metadata } from 'next';
import { Block, Code, Page, Pre, Table } from '@/components/page';
import { Playground } from './playground';

export const metadata: Metadata = {
  title: 'API',
  description: 'The One Moment decision layer as an API: send what your AssemblyAI stream heard, get back relay, ask or wait.',
};

export default function ApiPage() {
  const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:8787';
  return (
    <Page
      eyebrow="For developers"
      title="The patient-mode layer, as an API"
      intro={
        <p>
          Any voice application can add this: a pharmacy line, a bank, a telehealth platform. Send what your AssemblyAI stream
          heard. Get back what a careful partner would do: say it (and exactly what to say), ask (and the two-choice question),
          or keep waiting. It never guesses.
        </p>
      }
    >
      <Block id="try" title="Try it">
        <Playground />
      </Block>

      <Block id="request" title="POST /v1/decide">
        <Pre>{`curl -X POST ${base}/v1/decide \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ASSEMBLYAI_API_KEY" \\
  -d '{"transcript": "I need to refill my amlodipine prescription, please.", "name": "Robert"}'`}</Pre>
        <p>
          The key is optional. Without one, every turn that needs no model is still answered (a clear sentence, a disputed
          &ldquo;not&rdquo;), and the rest are asked rather than guessed. With your AssemblyAI key, it runs the Advocate and the
          Skeptic on the LLM Gateway on your account.
        </p>
        <Table
          caption="Request fields"
          head={['Field', 'Type', 'Meaning']}
          rows={[
            [<Code key="1">turn</Code>, 'Turn message', 'Best: the Turn message from your own Universal-Streaming session, as received. Word confidences and timings are used.'],
            [<Code key="2">fastTurn</Code>, 'Turn message', 'Optional: a second, differently configured stream on the same audio. Where the two disagree, it asks.'],
            [<Code key="3">transcript</Code>, 'string', 'Or plain text, if you have no Turn. Confidence is then treated as unknown.'],
            [<Code key="4">fastTranscript</Code>, 'string', 'Plain-text second reading.'],
            [<Code key="5">name</Code>, 'string', 'How to refer to the caller when relaying: "Robert says: ...".'],
            [<Code key="6">lexicon</Code>, 'string[]', 'The caller\'s own words: medicines, pharmacy, people. Up to 100.'],
            [<Code key="7">context</Code>, 'string', 'A sentence of context for the models.'],
            [<Code key="8">model</Code>, 'string', 'An LLM Gateway model id. Default: the smallest your key can use.'],
          ]}
        />
      </Block>

      <Block id="response" title="Response">
        <Table
          caption="Response fields"
          head={['Field', 'Meaning']}
          rows={[
            [<Code key="1">action</Code>, <span key="1b"><Code>relay</Code>, <Code>ask</Code> or <Code>hold</Code>.</span>],
            [<Code key="2">say</Code>, 'Exactly what to say to the other party. Only when action is relay.'],
            [<Code key="3">question</Code>, 'A two-choice question for the caller, each option with the sentence to relay if chosen. Only when action is ask.'],
            [<Code key="4">rule</Code>, 'Which Adjudicator rule decided, with its plain-language meaning.'],
            [<Code key="5">checks</Code>, 'The deterministic findings: disputed negation, invented words, flipped polarity.'],
            [<Code key="6">readings</Code>, 'What the Advocate and the Skeptic proposed, when models ran.'],
            [<Code key="7">heard</Code>, 'The evidence: both readings, disagreements, lowest confidence, hidden pauses.'],
            [<Code key="8">models</Code>, 'Which model ran, and how many calls it took. Often zero.'],
          ]}
        />
      </Block>

      <Block id="terms" title="Limits and privacy">
        <ul className="list-disc space-y-2 pl-5">
          <li>Stateless. Nothing you send is stored. A key, if sent, is used for that request only.</li>
          <li>Twenty requests a minute per address on the public demo.</li>
          <li>Also: <Code>GET /v1/models</Code> with your key lists the models it can use.</li>
          <li>MIT licensed. Run your own: the orchestrator is one Node process.</li>
        </ul>
      </Block>
    </Page>
  );
}
