import type { Metadata } from 'next';
import { ReplayPlayer } from '@/components/replay/replay-player';
import { CallRecordLink } from '@/components/replay/call-record';
import { Explain } from '@/components/explain';
import { RECORDING, RECORDING_CHOICE, RECORDING_DISSENT } from '@/content/measured';

export const metadata: Metadata = {
  title: 'Recorded calls',
  description: 'Three real calls through the live One Moment system, replayed with their audio and every event they produced.',
};

const CALLS = {
  pause: { title: 'The long pause', blurb: 'Robert stops for six seconds mid-sentence. The pharmacist fills the silence.', recording: RECORDING, audio: '/recorded/robert-call.mp3' },
  choice: { title: 'The half-found word', blurb: 'The medicine name only half comes out. It is never guessed.', recording: RECORDING_CHOICE, audio: '/recorded/robert-call-choice.mp3' },
  dissent: { title: 'The sentence that stops', blurb: 'He names the tablet, blocks for six seconds, and stops before the last word. A fragment cannot be relayed verbatim and is not a half-said name, so for the first time in these three calls both models run.', recording: RECORDING_DISSENT, audio: '/recorded/robert-call-dissent.mp3' },
} as const;

export default async function ReplayPage({ searchParams }: PageProps<'/replay'>) {
  const q = await searchParams;
  const id = q.call === 'choice' || q.call === 'dissent' ? q.call : 'pause';
  const video = q.video === '1';
  const call = CALLS[id];
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-accent">A recorded call</p>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight text-ink">
            {call.title}
            <Explain id="simulated" />
          </h1>
          <p className="mt-1 text-muted">{call.blurb} Computer voices; everything that listens and speaks for Robert was live.</p>
        </div>
        <nav aria-label="Recorded calls" className="flex gap-2 text-sm">
          {(Object.keys(CALLS) as (keyof typeof CALLS)[]).map((k) => (
            <a key={k} href={`/replay?call=${k}`} aria-current={k === id ? 'page' : undefined}
              className={`rounded-xl border px-4 py-2 font-medium ${k === id ? 'border-accent bg-accent-soft text-ink' : 'border-line-strong text-muted hover:text-ink'}`}>
              {CALLS[k].title}
            </a>
          ))}
        </nav>
      </header>
      <h2 className="sr-only">The call, moment by moment</h2>
      {/* The third call exists to show the Advocate and the Skeptic, and those
          live in the full engine view, so this one is not shown compact. */}
      <ReplayPlayer key={id} recording={call.recording} audioSrc={call.audio} compact={id !== 'dissent'} full={id === 'dissent'} video={video} />
      {!video && <CallRecordLink id={id} recording={call.recording} className="mt-6" />}
    </div>
  );
}
