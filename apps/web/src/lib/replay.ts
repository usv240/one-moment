'use client';

// Replay a recorded call from its stamped event log, in sync with the audio of
// that same call. The live view and the replay run the same reducer over the
// same events, so the replay cannot show anything the live call did not do.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ServerMessage } from '@one-moment/core';
import { initialCallState, reduceCall, type CallState } from './use-call';

export type Recording = { recordedAt: string; durationMs: number; events: ServerMessage[] };

export type Moment = { t: number; title: string; body: string };

const quote = (s: string) => `\u201c${s}\u201d`;

/**
 * The annotation track, derived from the events rather than typed by hand, so a
 * re-recorded call re-annotates itself and no caption can drift from the data.
 */
export function keyMoments(events: ServerMessage[]): Moment[] {
  const out: Moment[] = [];
  const first = <T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true) =>
    events.find((m): m is Extract<ServerMessage, { type: T }> => m.type === type && pred(m as Extract<ServerMessage, { type: T }>));

  const start = first('simulation', (m) => m.event === 'caller_sample_started');
  if (start) out.push({ t: start.t, title: 'Robert starts his sentence', body: 'Two AssemblyAI streams listen to the same microphone: a patient ear and a fast ear.' });

  const cut = first('turn', (m) => m.stream === 'fast' && m.turn.end_of_turn && /(\.\.\.|\u2026)$/.test(m.turn.transcript.trim()));
  if (cut) out.push({ t: cut.t, title: 'A normal voice agent would reply now', body: `The fast ear, set up like an ordinary agent, has already ended his turn: ${quote(cut.turn.transcript)} The patient ear keeps listening.` });

  const pharm = first('simulation', (m) => m.event === 'pharmacist_spoke');
  if (pharm) out.push({ t: pharm.t, title: 'The pharmacist fills the silence', body: `${quote(pharm.detail ?? 'Hello?')} Robert is still looking for the word.` });

  const hold = first('outward', (m) => m.kind === 'hold');
  if (hold) out.push({ t: hold.t, title: 'One Moment holds the line', body: `The Floor Controller approves one line and the Voice Agent says it: ${quote(hold.text)}` });

  const agentCut = first('agent_cut');
  if (agentCut) out.push({ t: agentCut.t, title: 'Robert finds the word', body: 'The hold line stops mid-sentence, the moment he speaks. The caller always has the floor.' });

  const early = first('log', (m) => /finished sentence/.test(m.message));
  if (early) out.push({ t: early.t, title: 'Finished, so no more waiting', body: 'Both ears agree the sentence is complete. The turn ends after 1.5 seconds of silence, not 6. An unfinished sentence would still get the full wait.' });

  const decided = first('dissent');
  if (decided) {
    const d = decided.result.decision;
    out.push(d.action === 'relay' && d.policyRule === 9
      ? { t: decided.t, title: 'His own words, nothing added', body: 'Complete and clear, so Robert\u2019s sentence is relayed exactly as he said it. Zero model calls.' }
      : { t: decided.t, title: d.action === 'ask' ? 'Not sure, so it asks Robert' : 'Decided', body: `Rule ${d.policyRule}.` });
  }

  const relay = first('outward', (m) => m.kind === 'relay');
  if (relay) out.push({ t: relay.t + 400, title: 'The pharmacist hears Robert', body: quote(relay.text) });

  const thanks = events.filter((m) => m.type === 'simulation' && m.event === 'pharmacist_spoke')[1];
  if (thanks && thanks.type === 'simulation') out.push({ t: thanks.t, title: 'He made the call', body: `The pharmacist answers him: ${quote(thanks.detail ?? '')}` });

  const audit = first('audit');
  if (audit) {
    const p = audit.audit.pause;
    const secs = (ms: number | null) => (ms === null ? '?' : `${(ms / 1000).toFixed(1)} seconds`);
    out.push({
      t: audit.t,
      title: 'Graded against itself',
      body: `After the call, AssemblyAI's pre-recorded model transcribed Robert's audio carefully. It heard the pause as ${secs(p.carefulMs)}, where the live stream showed ${p.liveGapMs ?? '?'}ms. ${audit.audit.verdict}`,
    });
  }

  return out.sort((a, b) => a.t - b.t);
}

export function stateAt(events: ServerMessage[], t: number): CallState {
  let s: CallState = { ...initialCallState, status: 'connecting' };
  for (const m of events) {
    if (m.t > t) break;
    s = reduceCall(s, { type: 'event', m });
  }
  return s;
}

export function useReplay(rec: Recording, audioSrc: string) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const moments = useMemo(() => keyMoments(rec.events), [rec.events]);
  const events = useMemo(() => [...rec.events].sort((a, b) => a.t - b.t || a.seq - b.seq), [rec.events]);
  // Snap up to 100ms so the reducer runs at most ten times a second, and a
  // jump to a moment always includes the event that defines it.
  const tick = Math.ceil(now / 100) * 100;
  const state = useMemo(() => stateAt(events, tick), [events, tick]);

  useEffect(() => {
    const a = new Audio(audioSrc);
    a.preload = 'auto';
    audio.current = a;
    const onEnd = () => setPlaying(false);
    a.addEventListener('ended', onEnd);
    return () => { a.pause(); a.removeEventListener('ended', onEnd); audio.current = null; };
  }, [audioSrc]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      if (audio.current) setNow(audio.current.currentTime * 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const play = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (a.ended || a.currentTime * 1000 >= rec.durationMs - 50) a.currentTime = 0;
    void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [rec.durationMs]);

  const pause = useCallback(() => { audio.current?.pause(); setPlaying(false); }, []);

  const seek = useCallback((ms: number) => {
    const t = Math.max(0, Math.min(rec.durationMs, ms));
    if (audio.current) audio.current.currentTime = t / 1000;
    setNow(t);
  }, [rec.durationMs]);

  const step = useCallback((dir: 1 | -1) => {
    const target = dir === 1
      ? moments.find((m) => m.t > now + 50)
      : [...moments].reverse().find((m) => m.t < now - 250);
    seek(target ? target.t : dir === 1 ? rec.durationMs : 0);
  }, [moments, now, seek, rec.durationMs]);

  const current = [...moments].reverse().find((m) => m.t <= now) ?? null;
  return { state, now, playing, play, pause, seek, step, moments, current, duration: rec.durationMs };
}
