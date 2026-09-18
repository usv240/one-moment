import type { Metadata } from 'next';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { fastConfig, holdLines, firstHoldLine, patientConfig, PARAMETER_REASONS, POLICY_RULES, DEFAULT_FLOOR_CONFIG, EARLY_END_SILENCE_MS } from '@one-moment/core';
import { Block, Code, Page, Table } from '@/components/page';
import { Cite } from '@/components/cite';

export const metadata: Metadata = {
  title: 'Technology',
  description: 'How One Moment is built on AssemblyAI Universal-Streaming, the Voice Agent API and the LLM Gateway, with every parameter and rule shown from the running code.',
};

const cfg = { ...DEFAULT_FLOOR_CONFIG, userName: 'Robert', pronoun: 'he' as const };

function Node({ title, sub, strong = false }: { title: string; sub: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 text-sm ${strong ? 'border-accent bg-accent-soft' : 'border-line bg-raised'}`}>
      <p className="font-semibold text-ink">{title}</p>
      <p className="mt-0.5 text-xs text-muted">{sub}</p>
    </div>
  );
}

const Down = () => <ArrowDown aria-hidden className="mx-auto h-4 w-4 text-subtle" />;

function Diagram() {
  return (
    <figure aria-label="Architecture" className="rounded-2xl border border-line bg-sunken p-4 sm:p-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
        <div className="space-y-2">
          <Node title="Caller's microphone" sub="16kHz PCM, 50ms frames" />
          <Down />
          <div className="grid grid-cols-2 gap-2">
            <Node title="Patient ear" sub="Universal-Streaming, max_accuracy, waits 6 to 9s, caller's vocabulary" strong />
            <Node title="Fast ear" sub="Universal-Streaming, min_latency, defaults, unbiased" />
          </div>
          <Down />
          <Node title="Evidence" sub="words, confidences, hidden pauses, where the ears disagree" />
          <Down />
          <Node title="Dissent" sub="rule 9 verbatim first; else Advocate and Skeptic via LLM Gateway; Adjudicator is code" />
        </div>
        <ArrowRight aria-hidden className="mx-auto hidden h-5 w-5 text-subtle lg:block" />
        <div className="space-y-2">
          <Node title="Floor Controller" sub="deterministic reducer: who may speak, when to hold, when to cut" strong />
          <Down />
          <Node title="Approved lines" sub="the only way a word reaches the far party" />
          <Down />
          <Node title="Our LLM endpoint" sub="not a model: returns approved text verbatim, or nothing" />
          <Down />
          <Node title="AssemblyAI Voice Agent" sub="hears the far party, speaks approved lines, reports what it said" strong />
          <Down />
          <Node title="The pharmacist" sub="hears the caller, and the agent only when it holds or relays" />
        </div>
      </div>
      <figcaption className="mt-4 text-sm text-muted">
        Three AssemblyAI sessions during the call, one careful transcription after it, and no model anywhere that can choose what the far party hears.
      </figcaption>
    </figure>
  );
}

export default function TechnologyPage() {
  const patient = patientConfig(['amlodipine', 'metformin', 'Walgreens'], 'Robert is calling his pharmacy.');
  const fast = fastConfig();
  const keys = [...new Set([...Object.keys(patient), ...Object.keys(fast)])].filter((k) => !['encoding', 'sample_rate'].includes(k));
  const show = (v: unknown) => (v === undefined ? <span className="text-muted">default</span> : <Code>{Array.isArray(v) ? `[${v.length} terms]` : String(v).length > 40 ? `"${String(v).slice(0, 37)}..."` : String(v)}</Code>);

  return (
    <Page
      eyebrow="Technology"
      title="How it is built"
      intro={<p>Everything on this page is rendered from the code that runs the calls: the stream settings, the rules, the hold lines. If the code changes, this page changes with it.</p>}
    >
      <Block id="architecture" title="The shape of a call">
        <Diagram />
      </Block>

      <Block id="assemblyai" title="What we use from AssemblyAI, and how">
        <Table
          caption="AssemblyAI products used"
          head={['Product', 'How One Moment uses it', 'The unusual part']}
          rows={[
            ['Universal-Streaming (Universal-3.5 Pro)', 'Two concurrent sessions on one microphone, configured in opposite directions.', 'Their disagreement is the uncertainty signal. ForceEndpoint ends the patient turn early when both ears agree a sentence is finished.'],
            ['Voice Agent API', 'The far-party leg: listens to the pharmacist, speaks for the caller.', 'Its LLM is our endpoint, which is not a model. The agent can only say lines our rules approved, and its own transcript.agent is our proof of what was said.'],
            ['Voice Agent API, stored agents', 'One agent per call, created over REST with a per-call token as its LLM key, deleted at the end.', 'The token identifies the call, so a stray request can never pull another call\'s words.'],
            ['LLM Gateway', 'The Advocate and the Skeptic, when speech is fragmentary. Also writes the two-choice question.', 'Used last, not first. A clear sentence never reaches a model.'],
            ['Pre-recorded transcription (/v2/transcript)', 'After the call, grades the live system against a careful transcript of the caller\'s own audio.', 'The live stream cannot see a pause; the pre-recorded model can. So this is where the pause is measured and every relayed word is checked.'],
            ['Voice Agent text to speech', 'The demo caller and pharmacist voices, via an agent\'s greeting.', 'Lets a judge hear a full call with no microphone and no second person.'],
          ]}
        />
        <p className="text-sm text-muted">Docs: <Cite id="aai-streaming" /><Cite id="aai-agent" /></p>
      </Block>

      <Block id="parameters" title="The two ears, exactly as configured">
        <p>
          The same model, pointed in opposite directions. Values shown are the objects the orchestrator sends when a call opens.
        </p>
        <Table
          caption="Streaming parameters"
          head={['Parameter', 'Patient ear', 'Fast ear', 'Why']}
          rows={keys.map((k) => [<Code key={k}>{k}</Code>, show(patient[k]), show(fast[k]), <span key="r" className="text-muted">{PARAMETER_REASONS[k] ?? ''}</span>])}
        />
        <p className="text-sm text-muted">
          Semantic patience: when the patient ear&apos;s running transcript ends like a finished sentence, the fast ear has closed a
          turn on the same last words, and the caller has been silent for {EARLY_END_SILENCE_MS / 1000} seconds, the orchestrator
          sends <Code>ForceEndpoint</Code>. A sentence that trails off still gets the full wait.
        </p>
      </Block>

      <Block id="rules" title="The Adjudicator: the rules that decide what is said">
        <p>
          Not a model. The first rule that matches decides. Rules 1, 2, 3 and 11 are checked by code, not by a model, so no model can
          argue past them, and rules 1 and 11 run before any model is called.
        </p>
        <Table
          caption="Adjudicator rules"
          head={['Rule', 'Name', 'In plain words']}
          rows={Object.entries(POLICY_RULES).map(([n, r]) => [<span key="n" className="font-mono">{n}</span>, <Code key="c">{r.name}</Code>, r.plain])}
        />
      </Block>

      <Block id="floor" title="The Floor Controller: who may speak">
        <p>
          A pure function from (state, event) to (state, actions). It never calls a model. Its one question: who is entitled to
          speak right now, and what does it do to protect that?
        </p>
        <Table
          caption="What the agent may say to the far party"
          head={['Situation', 'Line']}
          rows={[
            ['First time it holds the floor. Also the disclosure.', <span key="f" className="font-caller">&ldquo;{firstHoldLine(cfg)}&rdquo;</span>],
            ...holdLines(cfg).map((l, i) => [`Later holds, rotated (${i + 1})`, <span key={i} className="font-caller">&ldquo;{l}&rdquo;</span>]),
            ['Relaying a clear sentence', <span key="r" className="font-caller">&ldquo;Robert says: I need to refill my amlodipine prescription, please.&rdquo;</span>],
          ]}
        />
        <p className="text-sm text-muted">
          Holds respect a {DEFAULT_FLOOR_CONFIG.holdCooldownMs / 1000}-second cooldown, so the agent never talks over the far party
          repeatedly. After {DEFAULT_FLOOR_CONFIG.maxUnresolved} unresolved turns in a row, it stops speaking for the caller and produces an
          escalation packet for a human relay assistant: what is established, what is open, and both readings.
        </p>
      </Block>

      <Block id="learned" title="What the live API taught us">
        <p>Each of these was measured, and each changed the design.</p>
        <ul className="space-y-3">
          {[
            ['A mid-sentence pause is invisible in the live transcript.', 'A 6-second pause showed up as 46ms gaps between words; the silence was absorbed into the words around it. So the pause is measured from how stretched the words are.'],
            ['A closed session lingers.', 'Opening and closing streaming sessions quickly produced "Too many concurrent sessions". Holding four open at once did not. Never churn sessions mid-call.'],
            ['A dropped reply still reports "completed".', 'When the far party talks over the agent, the reply can be dropped with status completed and no transcript. So a line only counts as heard when the agent\'s own transcript contains all of it.'],
            ['The agent may call the LLM endpoint twice for one reply.', 'About half a second apart. Our endpoint is idempotent: it re-sends in-flight lines rather than dropping them.'],
            ['There is no cancel event.', 'But we relay the agent\'s audio, so when the caller speaks mid-hold we stop relaying it and browsers flush their buffers.'],
            ['The free LLM tier allows 2 requests a minute.', 'So a clear sentence is relayed in the caller\'s own words with zero model calls, and models are reserved for the turns that need them.'],
          ].map(([t, b]) => (
            <li key={t} className="rounded-xl border border-line bg-raised p-4">
              <p className="font-semibold text-ink">{t}</p>
              <p className="mt-1 text-sm text-muted">{b}</p>
            </li>
          ))}
        </ul>
      </Block>
    </Page>
  );
}
