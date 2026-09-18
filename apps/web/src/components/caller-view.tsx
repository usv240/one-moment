'use client';

// What the person making the call sees.
//
// Built to the aphasia-friendly formatting literature and to Hick's Law:
// at most three things on screen, very large type, one idea per line, two
// choices never ten. Deliberately absent: a transcript of their own disfluent
// speech, confidence numbers, and above all any timer. A clock on someone who
// cannot find a word adds pressure and makes the block worse.

import { useEffect, useRef } from 'react';
import { Hand, MessageCircle, Pill, Square, Users } from 'lucide-react';
import type { ForcedChoice } from '@one-moment/core';
import type { CallState } from '@/lib/use-call';

type Props = {
  state: CallState;
  level: React.RefObject<number>;
  onChoose: (q: ForcedChoice, optionId: string) => void;
  onSomethingElse: () => void;
  onStop: () => void;
};

type View = 'idle' | 'listening' | 'pausing' | 'holding' | 'thinking' | 'asking' | 'relaying' | 'escalating' | 'finished';

function viewOf(s: CallState): View {
  if (s.status === 'idle' || s.status === 'connecting') return 'idle';
  if (s.status === 'ending') return 'finished';
  if (s.complete || s.status === 'ended') return 'finished';
  if (s.question) return 'asking';
  switch (s.floor) {
    case 'ESCALATE': return 'escalating';
    case 'RELAYING': return 'relaying';
    case 'HOLDING': return 'holding';
    case 'USER_PAUSED': return 'pausing';
    case 'DECIDING': return 'thinking';
    default: return 'listening';
  }
}

function Ring({ level, tone }: { level: React.RefObject<number>; tone: 'listen' | 'hold' }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    const loop = () => {
      smooth = smooth * 0.8 + Math.min(1, (level.current ?? 0) * 6) * 0.2;
      if (el.current) el.current.style.transform = `scale(${1 + smooth * 0.35})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [level]);
  return (
    <div aria-hidden className="relative grid h-40 w-40 place-items-center">
      <div
        ref={el}
        className={`absolute inset-0 rounded-full transition-colors duration-300 ${
          tone === 'hold' ? 'hold-pulse bg-hold/25' : 'bg-accent-soft'
        }`}
      />
      <div className={`relative h-20 w-20 rounded-full ${tone === 'hold' ? 'bg-hold' : 'bg-accent/80'}`} />
    </div>
  );
}

const Big = ({ children }: { children: React.ReactNode }) => (
  <p className="font-caller text-[2.5rem] font-bold leading-tight tracking-tight text-ink">{children}</p>
);
const Small = ({ children }: { children: React.ReactNode }) => (
  <p className="font-caller text-xl text-muted">{children}</p>
);

export function CallerView({ state, level, onChoose, onSomethingElse, onStop }: Props) {
  const view = viewOf(state);
  const lastRelay = [...state.outward].reverse().find((o) => o.kind === 'relay');

  return (
    <section
      aria-label="What the caller sees"
      aria-live="polite"
      className="flex min-h-[32rem] flex-col items-center justify-center gap-8 px-6 py-10 text-center"
    >
      {view === 'idle' && (
        <>
          <Users aria-hidden className="h-14 w-14 text-subtle" />
          <Big>Ready when you are.</Big>
        </>
      )}

      {view === 'listening' && (
        <>
          <Ring level={level} tone="listen" />
          <Big>I&apos;m listening.</Big>
        </>
      )}

      {view === 'pausing' && (
        <>
          <Ring level={level} tone="listen" />
          <Big>Take your time.</Big>
        </>
      )}

      {view === 'holding' && (
        <>
          <Ring level={level} tone="hold" />
          <Big>Take your time.</Big>
          <Small>I&apos;ve asked them to wait.</Small>
        </>
      )}

      {view === 'thinking' && (
        <>
          <MessageCircle aria-hidden className="h-14 w-14 text-accent" />
          <Big>Got it.</Big>
        </>
      )}

      {view === 'asking' && state.question && (
        <div className="flex w-full max-w-md flex-col gap-5">
          <Big>{state.question.prompt}</Big>
          {state.question.options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onChoose(state.question!, o.id)}
              className="flex min-h-[88px] items-center justify-center gap-3 rounded-2xl border-2 border-line-strong bg-raised px-6 font-caller text-[2rem] font-bold text-ink shadow-1 transition-colors hover:border-accent hover:bg-accent-soft"
            >
              {o.icon === 'pill' && <Pill aria-hidden className="h-8 w-8 text-accent" />}
              {o.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onSomethingElse}
            className="min-h-[64px] rounded-2xl px-6 font-caller text-xl font-bold text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Something else
          </button>
        </div>
      )}

      {view === 'relaying' && (
        <div className="flex w-full max-w-md flex-col items-center gap-6">
          <Big>Telling them now.</Big>
          {lastRelay && (
            <p className="rounded-2xl bg-sunken px-6 py-5 font-caller text-2xl leading-snug text-ink">
              &ldquo;{lastRelay.text}&rdquo;
            </p>
          )}
          <button
            type="button"
            onClick={onStop}
            className="flex min-h-[88px] w-full items-center justify-center gap-3 rounded-2xl bg-danger px-6 font-caller text-[2rem] font-bold text-danger-fg shadow-2"
          >
            <Square aria-hidden className="h-7 w-7 fill-current" />
            Stop
          </button>
        </div>
      )}

      {view === 'escalating' && (
        <>
          <Hand aria-hidden className="h-14 w-14 text-accent" />
          <Big>I&apos;m getting a person to help.</Big>
          <Small>They will see everything so far.</Small>
        </>
      )}

      {view === 'finished' && (
        <>
          <Big>You made the call.</Big>
          {lastRelay && <Small>They heard: &ldquo;{lastRelay.text}&rdquo;</Small>}
        </>
      )}
    </section>
  );
}
