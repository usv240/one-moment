import Link from 'next/link';
import { ArrowRight, ClipboardCheck, Ear, Hand, Hourglass, MessageSquareQuote, Scale, Scissors } from 'lucide-react';
import { Cite, Section } from '@/components/cite';
import { Explain } from '@/components/explain';
import { ReplayTabs } from '@/components/replay/replay-tabs';
import { AUDIO, CALL, REFUSAL, SPIKE, VOCABULARY } from '@/content/measured';

export default function Home() {
  return (
    <>
      <Hero />
      <WhatItRefuses />
      <SixtySeconds />
      <OneSentence />
      <Section id="watch" eyebrow="Watch it happen" title="A real call, recorded, and scrubbable.">
        <p className="max-w-3xl text-lg text-muted">
          This is recorded data, not a video. The audio is one real call through the live system, and everything on screen
          is replayed from every event that call produced. Drag the timeline, or step moment by moment
          with the arrow keys. The caller and the pharmacist are computer voices; everything that listens, decides and speaks for
          Robert was running live.
          <Explain id="simulated" className="ml-2 align-middle" />
        </p>
        <div className="mt-8">
          <ReplayTabs />
        </div>
        <p className="mt-6 text-sm text-muted">
          Want the full engine view, with both listening streams, the pause chart and the decision rules?{' '}
          <Link href="/demo" className="font-medium text-accent underline underline-offset-2">Run a call yourself</Link>.
        </p>
      </Section>
      <HowItWorks />
      <Measured />
      <WhoPays />
      <NotThis />
      <Faq />
    </>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-7xl px-4 pb-12 pt-16 sm:px-6 sm:pt-24">
      <h1 className="max-w-4xl text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-6xl">
        Every voice agent is built to stop listening. This one is built to wait.
      </h1>
      <p className="mt-6 max-w-3xl text-xl leading-relaxed text-muted">
        One Moment waits as long as a stroke survivor needs, offers two choices when the word will not come, asks the
        pharmacist to hold the line, and speaks only the words he actually said.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <a href="#watch" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-fg shadow-1 hover:bg-accent-hover">
          See it happen
        </a>
        <Link href="/demo" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-raised px-5 font-semibold text-ink hover:border-accent">
          Try it yourself <ArrowRight aria-hidden className="h-4 w-4" />
        </Link>
      </div>
      <p className="mt-6 text-sm text-muted">
        Built on AssemblyAI Universal-Streaming and the Voice Agent API. Open source, MIT.
      </p>

      {/* The measured headline: the same recording, two settings. */}
      <figure className="mt-12 grid gap-3 rounded-2xl border border-line bg-raised p-5 shadow-1 sm:p-6 md:grid-cols-2">
        <figcaption className="md:col-span-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          The same recording, with a {(SPIKE.pauseMs / 1000).toFixed(1)}-second pause in the middle of the sentence
          <Explain id="turn-detection" />
        </figcaption>
        <div className="rounded-xl bg-sunken p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted">AssemblyAI default settings: {SPIKE.defaultTurns} turns</p>
          <ol className="mt-3 space-y-2 font-caller text-lg text-ink">
            <li>&ldquo;{SPIKE.defaultSplit[0]}&rdquo;</li>
            <li aria-hidden className="flex items-center gap-2 text-xs font-medium not-italic text-muted">
              <Scissors className="h-4 w-4" /> turn ended here
            </li>
            <li>&ldquo;{SPIKE.defaultSplit[1]}&rdquo;</li>
          </ol>
          <p className="mt-3 text-sm text-muted">The agent treats him trailing off as a finished turn, and starts talking.</p>
        </div>
        <div className="rounded-xl border-2 border-accent bg-raised p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-accent">One Moment&apos;s patient ear: {SPIKE.patientTurns} turn</p>
          <p className="mt-3 font-caller text-lg text-ink">&ldquo;{SPIKE.patientHeld}&rdquo;</p>
          <p className="mt-3 text-sm text-muted">He keeps his turn. The sentence arrives whole.</p>
        </div>
      </figure>
    </section>
  );
}

/**
 * What it refused to do, stated before anything it can do.
 *
 * A relay that invents one word is worse than no relay, so the number that
 * matters most is a zero. Both directions are shown: it must not put words in
 * the caller's mouth, and it must not get in the way when nothing is wrong.
 * Every figure comes from the committed benchmark files.
 */
function Refusal({ value, label, children }: { value: string; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-raised p-5">
      <p className="font-mono text-4xl font-semibold tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{label}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
}

function WhatItRefuses() {
  const r = REFUSAL;
  return (
    <Section
      id="refuses"
      eyebrow="Measured, on speech we did not record"
      title="The number that matters is a zero."
    >
      <p className="max-w-3xl text-lg text-muted">
        Speaking for someone is not like answering them. One invented word and the relay is worse than useless, because the
        caller cannot hear what was said in their name. So the first thing we measured is what it refuses to say.
        <Explain id="invented-words" className="ml-2 align-middle" />
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Refusal value={String(r.invented.ours)} label="Words put in the caller's mouth">
          Across {r.invented.of} relays of degraded speech. A single model asked what the person meant added them in{' '}
          {r.invented.baseline}.
        </Refusal>
        <Refusal value={String(r.flipped.ours)} label="Meanings flipped">
          Of {r.flipped.of} relayed sentences carrying a &ldquo;not&rdquo;. The same model flipped {r.flipped.baseline}, every one
          of them a sentence where a word had been lost.
        </Refusal>
        {r.clean && (
          <Refusal value={String(r.clean.overAsked)} label="Unnecessary questions on clear speech">
            All {r.clean.relayed} of {r.clean.n} clear sentences went straight through in the speaker&apos;s own words, with no
            model call. Caution that got in the way would be its own failure.
          </Refusal>
        )}
        {r.audit && (
          <Refusal value={String(r.audit.falseAlarms)} label="False alarms from the self-audit">
            On {r.audit.rightRelays} relays that were in fact correct, on real disordered speech. What it missed is published
            too.
          </Refusal>
        )}
      </div>
      <p className="mt-6 text-sm text-muted">
        {AUDIO && (
          <>
            On the hard cases it buys those zeros by asking instead of speaking: it asked on {AUDIO.oneMoment.asked} of{' '}
            {AUDIO.sentences} real dysarthric sentences, and spoke on {AUDIO.oneMoment.spoke}.{' '}
          </>
        )}
        Every figure here is derived from the committed run files, and the failures are published beside the wins:{' '}
        <Link href="/evidence" className="font-medium text-accent underline underline-offset-2">the evidence</Link>.
      </p>
    </Section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-raised p-6">
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <div className="space-y-3 leading-relaxed text-ink">{children}</div>
    </div>
  );
}

function SixtySeconds() {
  return (
    <Section id="understand" eyebrow="Understand this in 60 seconds" title="The word is not lost. It is late.">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="The problem">
          <p>
            Robert had a stroke. His thinking is fine. His words are not. When he speaks, the word he wants goes missing for
            six seconds, and then it arrives.
            <Explain id="aphasia" className="ml-2 align-middle" />
          </p>
          <p className="text-muted">
            Two to four million people in the US live with aphasia. <Cite id="asha" />
          </p>
        </Card>
        <Card title="Why nobody has solved it">
          <p>It is not his voice. His words are clear when they come.</p>
          <p>
            It is the clock. In conversation the usual gap between turns is about 208 milliseconds, and long gaps read as
            trouble. <Cite id="stivers" /> Voice agents are built for that clock. On a recording of Robert&apos;s sentence,
            the default settings ended his turn in the middle of it.
          </p>
        </Card>
        <Card title="What we built">
          <p>
            One Moment joins the call. It waits as long as he needs. And when the pharmacist starts to fill the silence, it
            speaks to her:
          </p>
          <p className="font-caller text-xl font-bold">&ldquo;One moment please, he&apos;s still with you.&rdquo;</p>
          <p>She waits. He finishes. He made the call.</p>
        </Card>
      </div>
    </Section>
  );
}

function OneSentence() {
  return (
    <section className="border-y border-line bg-sunken">
      <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20">
        <p className="text-2xl font-semibold leading-snug tracking-tight text-ink sm:text-3xl">
          The best-evidenced way to help someone with aphasia talk is to train the other person in the conversation. You
          cannot train the pharmacist. So we put a trained conversation partner inside the call.
        </p>
        <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-muted">
          Two systematic reviews of communication partner training, 56 studies between them, all report positive outcomes.
          <Cite id="smackie2010" /><Cite id="smackie2016" /> No study has tested an automated partner. This is an untested
          application of a well-evidenced principle, and we say so.
        </p>
      </div>
    </section>
  );
}

const STEPS = [
  { Icon: Ear, title: 'It listens twice', body: 'Two AssemblyAI streams on one microphone: a patient ear that waits up to nine seconds, and a fast ear set like any other agent. Where they disagree, the audio was unclear.', explain: 'two-streams' },
  { Icon: Hourglass, title: 'It waits, and knows when to stop', body: 'An unfinished sentence gets the full wait. A finished one, agreed by both ears, ends after 1.5 seconds of silence, so the other person is not left in dead air.', explain: 'turn-detection' },
  { Icon: Hand, title: 'It holds the line', body: 'If the other person starts talking into the pause, it asks them to wait. The moment the caller speaks again, it stops, mid-word if it has to.', explain: 'hold' },
  { Icon: MessageSquareQuote, title: 'It uses his own words', body: 'A clear, complete sentence is passed on exactly as he said it. No model is involved, so no model can add a word.', explain: 'verbatim' },
  { Icon: Scale, title: 'It argues with itself', body: 'When speech is broken up, one AI proposes a meaning and a second looks for anything he did not say. A fixed rule decides. When in doubt, it asks him, with two real choices.', explain: 'dissent' },
  { Icon: ClipboardCheck, title: 'It grades itself', body: 'After the call, a slower, more careful AssemblyAI model transcribes the recording. Every word said on his behalf is checked against it, and the pause the live stream could not see is finally measured.', explain: 'self-audit' },
];

function HowItWorks() {
  return (
    <Section id="how" eyebrow="How it works" title="Six things a good conversation partner does.">
      <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-3 rounded-2xl border border-line bg-raised p-5">
            <div className="flex items-center justify-between">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft">
                <s.Icon aria-hidden className="h-5 w-5 text-accent" />
              </span>
              <Explain id={s.explain} />
            </div>
            <h3 className="font-semibold text-ink"><span className="font-mono text-sm text-muted">{i + 1}.</span> {s.title}</h3>
            <p className="text-sm leading-relaxed text-ink">{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-raised p-6">
          <h3 className="flex items-center gap-2 font-semibold text-ink">Why the voice cannot invent words <Explain id="voice-agent-brain" /></h3>
          <p className="mt-3 leading-relaxed text-ink">
            The voice the pharmacist hears is an AssemblyAI Voice Agent. Its &ldquo;language model&rdquo; is our endpoint,
            and our endpoint is not a model. It returns exactly the line our rules approved, or nothing. We tested this
            against the live API: the agent spoke our text word for word, and stayed silent when we approved nothing.
            <Cite id="aai-agent" />
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-raised p-6">
          <h3 className="flex items-center gap-2 font-semibold text-ink">Why it never asks &ldquo;is that right?&rdquo; <Explain id="forced-choice" /></h3>
          <p className="mt-3 leading-relaxed text-ink">
            In aphasia the default answer is often yes, whether or not it is right. So it never asks for a yes. It offers two
            real choices, at most four words each, and the answer tells it something either way. Fixed-choice questions are a
            published Supported Conversation technique. <Cite id="sca" />
          </p>
        </div>
      </div>
    </Section>
  );
}

function Stat({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="rounded-2xl border border-line bg-raised p-5">
      <p className="font-mono text-3xl font-semibold tracking-tight text-ink">{value}</p>
      <p className="mt-2 font-medium text-ink">{label}</p>
      <p className="mt-1 text-sm text-muted">{note}</p>
    </div>
  );
}

function Measured() {
  const pct = (((SPIKE.actualMs - SPIKE.recoveredMs) / SPIKE.actualMs) * 100).toFixed(1);
  return (
    <Section id="measured" eyebrow="Measured, not claimed" title="Every number here came from the live API.">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat value={`${SPIKE.defaultTurns} vs ${SPIKE.patientTurns}`} label="Turns for one sentence" note={`Default settings split a ${(SPIKE.pauseMs / 1000).toFixed(1)}s pause into two turns. Our patient ear kept one.`} />
        <Stat value={`${SPIKE.realtimeGapMs}ms`} label="What a 6-second pause looks like live" note="The realtime transcript hides the pause inside the words around it, so we measure how stretched the words are." />
        <Stat value={`${pct}%`} label="Error recovering the hidden pause" note={`${SPIKE.recoveredMs}ms of silence recovered from word timings, against ${SPIKE.actualMs}ms actual.`} />
        <Stat value={`${SPIKE.secondStreamMs}ms`} label="Cost of listening twice" note="A second, differently configured stream added no measurable latency to the first result." />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CALL.modelCalls === 0 && (
          <Stat value="0" label="Model calls to relay his sentence" note={`On the recorded call, a clear and complete sentence was relayed in his own words by rule 9, decided in ${CALL.decisionMs !== null && CALL.decisionMs < 1 ? 'under a millisecond' : `${CALL.decisionMs}ms`}.`} />
        )}
        <Stat value="1.5s" label="Wait after a finished sentence" note="Both ears must agree it is finished. An unfinished one still gets the full 6 seconds and more." />
        <Stat
          value={`${VOCABULARY.boostedHeardTerm} of ${VOCABULARY.variants}`}
          label="Slurred medicine names the boosted ear 'heard' as amlodipine"
          note={`The unbiased ear heard it ${VOCABULARY.unbiasedHeardTerm} times. So a word only the listening-for-it ear heard is asked about, never trusted.`}
        />
        {CALL.audit && CALL.audit.pause.carefulMs !== null && (
          <Stat
            value={`${(CALL.audit.pause.carefulMs / 1000).toFixed(1)}s`}
            label="The pause, measured after the call"
            note={`AssemblyAI's pre-recorded model heard it; the live stream showed ${CALL.audit.pause.liveGapMs}ms. ${CALL.audit.allConfirmed ? 'Every relayed word was confirmed.' : ''}`}
          />
        )}
        <Stat value="0" label="Words the agent may choose itself" note="The Voice Agent's only source of words is the line our rules approved. Checked live, every call, against AssemblyAI's own transcript of the agent." />
      </div>
      {AUDIO && (
        <div className="mt-4 rounded-2xl border-2 border-accent bg-raised p-5">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent">On real disordered speech</p>
          <p className="mt-2 text-lg text-ink">
            {AUDIO.sentences} recorded sentences from {AUDIO.speakers} speakers with dysarthria (TORGO), through both live ears. An ordinary
            agent would have relayed words the speaker never said, or flipped the meaning, in{' '}
            <b>{AUDIO.ordinary.wrong} of {AUDIO.ordinary.spoke}</b> sentences. One Moment did in{' '}
            <b>{AUDIO.oneMoment.wrong} of the {AUDIO.oneMoment.spoke}</b> it spoke, and asked the caller on {AUDIO.oneMoment.asked}.
          </p>
          <a href="/evidence#audiobench" className="mt-2 inline-block text-sm font-medium text-accent underline underline-offset-2">How it was measured, and every sentence</a>
        </div>
      )}
      <p className="mt-6 max-w-3xl text-sm text-muted">
        Measured 17 and 18 September 2026 on synthetic speech with an exactly known pause. The scripts are in the repository and
        re-run against your own key. Synthetic speech is clean; real disordered speech will score lower on recognition, which is
        why nothing here depends on recognition being right.
      </p>
    </Section>
  );
}

function WhoPays() {
  return (
    <Section id="who-pays" eyebrow="Who pays for this" title="A service already exists, is required by law, and is under-used.">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat value="2 to 4M" label="People in the US with aphasia" note="Plus about 7.5 million with trouble using their voices." />
        <Stat value="$8.4822" label="Per minute, today" note="What the federal relay fund pays for Speech-to-Speech Relay, a trained human repeating the caller's words." />
        <Stat value="Required" label="In every state" note="Speech-to-Speech Relay is mandated under ADA Title IV, reachable by dialling 711." />
        <Stat value="Under-used" label="The regulator's own words" note="The FCC describes the service as under-utilised despite outreach." />
      </div>
      <p className="mt-6 max-w-3xl leading-relaxed text-ink">
        Sources: <Cite id="asha" /><Cite id="nidcd" /><Cite id="fcc-rates" /><Cite id="fcc-sts" /> One reason the service is
        under-used: you wait for a trained stranger before you can make a call, and that stranger hears your medical
        conversation. One Moment costs two streaming sessions and one voice agent session per minute. Most turns need no model
        call at all. We are not proposing to replace the human. Automate the routine calls, and a trained human is free for the
        ones that need one.
      </p>
    </Section>
  );
}

function NotThis() {
  return (
    <Section id="not" eyebrow="What this is not" title="Honest limits, stated as measurements.">
      <ul className="grid gap-4 md:grid-cols-2">
        {[
          ['Not tested with people with aphasia.', `Every number on this page comes from synthetic speech, published text corpora${AUDIO ? `, and ${AUDIO.sentences} recorded sentences from speakers with dysarthria (a motor speech disorder, not aphasia)` : ''}, with ground truth we did not write. It is a working prototype, not a clinical study.`],
          ['Not a medical device.', 'It does not diagnose or treat anything. It is a conversation partner on a phone call.'],
          ['Not better recognition.', 'We do not improve speech recognition on disordered speech. The design assumes recognition is often wrong, and refuses to speak when it is unsure.'],
          ['The demo far party is simulated.', 'The pharmacist in the demo is a computer voice. The system has not been tested against a live pharmacy.'],
        ].map(([t, b]) => (
          <li key={t} className="rounded-2xl border border-line bg-raised p-5">
            <p className="font-semibold text-ink">{t}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{b}</p>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted">
        If your words come out distorted but your sentences are complete, tools like Voiceitt or Google&apos;s Project Relate
        serve that problem well and have real users. One Moment is for a different situation: the sentence stops, and the
        word arrives late. <Link href="/limits" className="font-medium text-accent underline underline-offset-2">Every limit, in full</Link>.
      </p>
    </Section>
  );
}

const FAQ: [string, string][] = [
  ['Is this a real product or a hackathon demo?', 'A working prototype, built for the AssemblyAI Voice Agent Hackathon. The engine runs against the live AssemblyAI APIs. It has not been used by a person with aphasia, and it is not a medical device.'],
  ['What happens when the speech recognition is wrong?', 'It is wrong often. That is the whole design problem. Nothing is said to the other person unless it traces back to words in the audio, and when it does not, the system asks the caller instead of guessing.'],
  ['Could it say something I did not say?', 'That is the failure we designed against hardest. A clear sentence is relayed in your own words with no model involved. When a model is involved, a second model looks for words you did not say, and the decision to speak is made by fixed rules you can read, not by a model. The voice itself can only speak lines those rules approved.'],
  ['Why two speech recognition streams? Is that not wasteful?', 'It adds one streaming session to a call that today costs $8.4822 a minute in human time. And where the two streams disagree is the only honest measure of uncertainty the system has.'],
  ['Why does it never ask me yes or no?', 'Because in aphasia "yes" is often the default answer, whether or not it is right. Clinicians use a questionnaire just to find out whether a person\'s yes can be trusted. Two real choices avoid the problem.'],
  ['What happens when it stops mid-sentence?', 'The hold line exists to protect your turn, so it must never talk over you. When you start speaking again, the orchestrator stops relaying the agent\'s audio at once. If that cut off the part where it said it is an assistant, it says so again before it next speaks for you.'],
];

function Faq() {
  return (
    <Section id="faq" eyebrow="Questions" title="The ones a sceptic asks.">
      <div className="max-w-3xl divide-y divide-line rounded-2xl border border-line bg-raised">
        {FAQ.map(([q, a]) => (
          <details key={q} className="group px-5 py-4">
            <summary className="cursor-pointer list-none font-semibold text-ink marker:hidden">
              <span className="flex items-center justify-between gap-4">
                {q}
                <span aria-hidden className="text-muted transition-transform group-open:rotate-45">+</span>
              </span>
            </summary>
            <p className="mt-3 leading-relaxed text-ink">{a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
