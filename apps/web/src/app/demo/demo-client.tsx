'use client';

// The live demo. Two views of one call: what the caller sees, and what is
// actually happening. Side by side from the lg breakpoint, tabs below it.

import { useEffect, useState } from 'react';
import { FileDown, Mic, Pill, Play, PhoneOff, RotateCcw, Scale } from 'lucide-react';
import { CallerView } from '@/components/caller-view';
import { ObserverView } from '@/components/observer/observer-view';
import { Explain } from '@/components/explain';
import { ORCHESTRATOR_URL, useCall, type Mode } from '@/lib/use-call';
import type { Scenario } from '@one-moment/core';
import { ReplayTabs } from '@/components/replay/replay-tabs';
import { hasProfile, useSettings } from '@/lib/settings';
import Link from 'next/link';

type Health = 'checking' | 'online' | 'offline';

export function DemoClient() {
  const call = useCall();
  const { state } = call;
  const [tab, setTab] = useState<'caller' | 'observer'>('caller');
  const [health, setHealth] = useState<Health>('checking');
  const [mode, setMode] = useState<Mode | null>(null);
  const { settings, key } = useSettings();
  const [grade, setGrade] = useState(false);
  const own = hasProfile(settings);

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`${ORCHESTRATOR_URL}/health`, { signal: ctl.signal })
      .then((r) => setHealth(r.ok ? 'online' : 'offline'))
      .catch(() => { if (!ctl.signal.aborted) setHealth('offline'); });
    return () => ctl.abort();
  }, []);

  const running = state.status === 'connecting' || state.status === 'live' || state.status === 'ending';
  const begin = (m: Mode, scenario?: Scenario) => { setMode(m); void call.start(m, { grade, ...(scenario ? { scenario } : {}) }); };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6">
      <header className="max-w-3xl space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Try a call</h1>
        <p className="text-lg text-muted">
          Robert had a stroke and has aphasia. He is calling his pharmacy. Halfway through his sentence he stops for six
          seconds to find a word. Watch what happens to that pause.
          <Explain id="aphasia" className="ml-2 align-middle" />
        </p>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {health === 'offline' ? null : !running ? (
          <>
            <button
              type="button"
              onClick={() => begin('sample')}

              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-fg shadow-1 transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {state.status === 'idle' ? <Play aria-hidden className="h-5 w-5" /> : <RotateCcw aria-hidden className="h-5 w-5" />}
              {state.status === 'idle' ? 'Play the recorded call' : 'Play it again'}
            </button>
            <button
              type="button"
              onClick={() => begin('sample', 'choice')}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-raised px-5 font-semibold text-ink transition-colors hover:border-accent"
            >
              <Pill aria-hidden className="h-5 w-5" />
              Play the harder call
            </button>
            {/* The only one of the three where the Advocate and the Skeptic run. */}
            <button
              type="button"
              onClick={() => begin('sample', 'dissent')}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-raised px-5 font-semibold text-ink transition-colors hover:border-accent"
            >
              <Scale aria-hidden className="h-5 w-5" />
              Play the unfinished sentence
            </button>
            <button
              type="button"
              onClick={() => begin('live')}

              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-raised px-5 font-semibold text-ink transition-colors hover:border-accent disabled:opacity-50"
            >
              <Mic aria-hidden className="h-5 w-5" />
              Use my microphone
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={call.end}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-raised px-5 font-semibold text-ink hover:border-accent"
          >
            <PhoneOff aria-hidden className="h-5 w-5" />
            End the call
          </button>
        )}
        <EngineStatus health={health} status={state.status} />
        {/* What was said in your name, to keep. The one artifact a relay call
            should leave behind, because the caller never heard it go out. */}
        {!running && state.callId && (
          <a
            href={`${ORCHESTRATOR_URL}/calls/${state.callId}/record.txt`}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-raised px-5 font-semibold text-ink hover:border-accent"
          >
            <FileDown aria-hidden className="h-5 w-5" />
            What was said in my name
          </a>
        )}
      </div>
      {health !== 'offline' && !running && (
        <p className="mt-3 text-sm text-muted">
          {own
            ? <>&ldquo;Use my microphone&rdquo; calls as <b className="text-ink">{settings.name}</b>{settings.words.length ? `, with ${settings.words.length} of your words` : ''}.</>
            : <>&ldquo;Use my microphone&rdquo; calls as Robert, with his words.</>}
          {key.key ? ' Using your AssemblyAI key.' : ''}{' '}
          <Link href="/setup" className="font-medium text-accent underline underline-offset-2">{own ? 'Change' : 'Make it yours'}</Link>
        </p>
      )}
      {health !== 'offline' && !running && (
        <label className="mt-2 flex max-w-3xl items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={grade} onChange={(e) => setGrade(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" />
          <span>
            Grade my microphone call afterwards. Your audio is kept in memory until the call ends, sent once to AssemblyAI&apos;s
            pre-recorded model, then dropped. The recorded call is always graded.
          </span>
        </label>
      )}

      {mode === 'live' && running && (
        <p className="mt-3 max-w-3xl text-sm text-muted">
          You are the caller. Start a sentence, then stop in the middle for a few seconds, as if you cannot find a word. A
          simulated pharmacist will try to speak. Then finish your sentence.
        </p>
      )}
      {state.error && (
        <div role="alert" className="mt-3 max-w-3xl rounded-lg border border-vetoed bg-raised px-3 py-2 text-sm text-ink">
          <p>{state.error}</p>
          {/* A refusal that names somewhere to go should let you go there. */}
          {(state.error.includes('/replay') || state.error.includes('setup page')) && (
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {state.error.includes('/replay') && (
                <Link href="/replay" className="font-medium text-accent underline underline-offset-2">Hear the recorded calls</Link>
              )}
              {state.error.includes('setup page') && (
                <Link href="/setup" className="font-medium text-accent underline underline-offset-2">Bring your own key</Link>
              )}
            </p>
          )}
        </div>
      )}

      {health === 'offline' && (
        <div className="mt-8 space-y-6">
          <p className="max-w-3xl rounded-lg border border-line bg-raised px-4 py-3 text-ink">
            The live engine is not reachable right now, so here is a recording of a real call through it instead: the same
            audio, and every event it produced, replayed through the same code.
          </p>
          <ReplayTabs full />
        </div>
      )}

      {health !== 'offline' && <>
      <p className="mt-8 text-sm font-medium text-muted">
        Left is what the person using it sees. Right is what is actually happening. Both are live.
      </p>

      <div role="tablist" aria-label="Choose a view" className="mt-3 flex gap-1 rounded-xl bg-sunken p-1 lg:hidden">
        {(['caller', 'observer'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            onClick={() => setTab(t)}
            className={`min-h-11 flex-1 rounded-lg text-sm font-semibold ${tab === t ? 'bg-raised text-ink shadow-1' : 'text-muted'}`}
          >
            {t === 'caller' ? 'What the caller sees' : 'What is happening'}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-6 lg:mt-0 lg:grid-cols-[minmax(20rem,26rem)_1fr]">
        <div id="panel-caller" className={`${tab === 'caller' ? '' : 'hidden'} lg:block`}>
          <div className="rounded-[2rem] border border-line bg-raised shadow-2 lg:sticky lg:top-20">
            <p className="border-b border-line px-6 py-3 text-xs font-medium uppercase tracking-wider text-muted">The caller&apos;s screen</p>
            <CallerView
              state={state}
              level={call.level}
              onChoose={call.choose}
              onSomethingElse={call.somethingElse}
              onStop={call.stop}
            />
          </div>
        </div>
        <div id="panel-observer" className={`${tab === 'observer' ? '' : 'hidden'} min-w-0 lg:block`}>
          <ObserverView state={state} />
        </div>
      </div>
      </>}
    </div>
  );
}

function EngineStatus({ health, status }: { health: Health; status: string }) {
  if (health === 'checking') return <span className="text-sm text-muted">Checking the engine</span>;
  if (health === 'offline') return <span className="text-sm text-muted">Engine offline</span>;
  const label = status === 'connecting' ? 'Connecting' : status === 'live' ? 'Call in progress' : status === 'ending' ? 'Grading the call' : 'Engine online';
  return (
    <span className="flex items-center gap-2 text-sm text-muted">
      <span aria-hidden className={`h-2 w-2 rounded-full ${status === 'live' ? 'hold-pulse bg-accent' : 'bg-accent'}`} />
      {label}
    </span>
  );
}
