import type { Metadata } from 'next';
import { Block, Page, Table } from '@/components/page';
import { AUDIO } from '@/content/measured';

export const metadata: Metadata = {
  title: 'What it does not do',
  description: 'The limits of One Moment, stated as measurements and scope, and the controls on the one failure that matters most.',
};

export default function LimitsPage() {
  return (
    <Page
      eyebrow="Limits"
      title="What it does not do"
      intro={<p>This system speaks on behalf of people who cannot easily correct it. So the limits are not a disclaimer at the end. They are the design.</p>}
    >
      <Block id="central" title="The failure that matters most">
        <p>
          The worst thing this product could do is say something the caller did not mean, to a stranger, in the caller&apos;s
          name, faster than they can correct it. Everything else is secondary. These are the controls, in order of strength.
        </p>
        <ol className="space-y-3">
          {[
            ['The voice has no words of its own.', 'The AssemblyAI Voice Agent that speaks to the far party uses our endpoint as its language model, and our endpoint is not a model. It returns a line the rules approved, or nothing. The live view checks every reply against AssemblyAI\'s own transcript of what the agent said.'],
            ['His own words first.', 'A clear, complete sentence is relayed exactly as he said it, with no model involved.'],
            ['Rules, not a model, decide.', 'The Adjudicator is code: a short ordered list of rules anyone can read on the technology page. A disputed "not", an invented word or a flipped yes and no each force a question.'],
            ['Every doubt leads to asking.', 'When the system is unsure, slow, rate limited or broken, it asks the caller with two real choices. It never guesses.'],
            ['The caller can always stop it.', 'A Stop button is on screen whenever it is speaking for him. And the moment he starts talking again, a hold line is cut off, mid-word if it has to be.'],
          ].map(([t, b], i) => (
            <li key={t} className="rounded-xl border border-line bg-raised p-4">
              <p className="font-semibold text-ink"><span className="font-mono text-sm text-muted">{i + 1}.</span> {t}</p>
              <p className="mt-1 text-sm text-muted">{b}</p>
            </li>
          ))}
        </ol>
        <p>
          <b>None of these is sufficient on its own.</b> The Skeptic will miss things. If both listening streams lose the same
          &ldquo;not&rdquo;, the text no longer contains it and no check can recover it; the benchmark publishes how often. So
          this is positioned as a first line with a human behind it, never as a replacement for a trained relay assistant.
        </p>
      </Block>

      <Block id="scope" title="What we measured, and what we did not">
        <Table
          caption="Scope"
          head={['Claim', 'Status']}
          rows={[
            ['Tested with people with aphasia', `No. The numbers come from synthetic speech with a known pause, published text corpora${AUDIO ? `, and ${AUDIO.sentences} recorded sentences from ${AUDIO.speakers} speakers with dysarthria (TORGO), which is a motor speech disorder, not aphasia` : ''}. It is a working prototype, not a clinical study.`],
            ['A medical device', 'No. It does not diagnose or treat. It is a conversation partner on a phone call.'],
            ['Better recognition of disordered speech', 'No. We do not improve recognition, and the design assumes it is often wrong.'],
            ['Tested against a live pharmacy', 'No. The far party in the demo is simulated with a computer voice.'],
            ['Real phone calls', 'Not yet. The far party is connected through our orchestrator, not the phone network. Telephony, over SIP, is the next step.'],
            ['Works for every kind of aphasia', 'Unknown. It is designed around word-finding pauses. Fluent aphasia, where speech flows but words are wrong, is a different problem.'],
            ['Ready for many callers at once', 'Not on the shared demo key. Every call opens two streaming sessions and our account holds four, so the public demo runs two live calls at a time and refuses the third rather than failing mid-call. Bring your own key and that limit is yours, not ours. The two recorded calls are always available.'],
          ]}
        />
      </Block>

      <Block id="consent" title="Consent, disclosure and privacy">
        <Table
          caption="Consent and privacy"
          head={['Requirement', 'What it does']}
          rows={[
            ['The far party knows an assistant is present', 'The first line it ever says includes it: "I\'m his assistant." If that line is cut off because the caller spoke, it is said again before the agent next speaks for him.'],
            ['The agent never claims to be the caller', 'It relays in the third person: "Robert says: ...".'],
            ['Audio is not stored', 'Caller audio is kept only if retention is explicitly switched on. It is off by default and in the demo.'],
            ['Your API key stays on the server', 'The browser never sees an AssemblyAI key. It talks only to the orchestrator.'],
          ]}
        />
      </Block>

      <Block id="others" title="Who does the adjacent job better">
        <p>
          Voiceitt and Google&apos;s Project Relate make distorted speech intelligible, and they have real users. If your words
          come out unclear but your sentences are complete, use one of those. One Moment is for a different situation: the
          sentence stops, and the word arrives late. Clearer audio does not help, because the audio was already clear.
        </p>
      </Block>
    </Page>
  );
}
