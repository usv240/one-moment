'use client';

// The browser side of a call: one WebSocket to the orchestrator, JSON control
// messages both ways, binary audio both ways. All call state is derived from
// the server's stamped event stream, so the live view and the replay are the
// same code reading the same events.

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
  CallAudit, DissentResult, EvidenceBundle, FloorModel, FloorState, ForcedChoice, Scenario, ServerMessage, StreamTurn,
} from '@one-moment/core';
import { Player, speakInBrowser, startCapture, type Capture } from './audio';
import { hasProfile, loadKey, loadSettings, toProfile } from './settings';

export const ORCHESTRATOR_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:8787';
const wsUrl = () => ORCHESTRATOR_URL.replace(/^http/, 'ws') + '/ws';

export type Mode = 'sample' | 'live';
export type Status = 'idle' | 'connecting' | 'live' | 'ending' | 'ended' | 'error';

export type DecisionRecord = { result: DissentResult; evidence: EvidenceBundle | null; t: number };

export type OutwardLine = { kind: 'disclosure' | 'hold' | 'relay'; text: string; t: number; spoken: boolean; cut?: boolean };

export type CallState = {
  status: Status;
  error: string | null;
  callId: string | null;
  farLeg: 'voice-agent' | 'browser' | null;
  caller: string;
  lexicon: string[];
  floor: FloorState;
  stats: FloorModel['stats'];
  partial: { patient: string; fast: string };
  patientTurns: StreamTurn[];
  fastTurns: StreamTurn[];
  evidence: EvidenceBundle | null;
  dissent: DissentResult | null;
  /** Every decision, paired with the evidence it was made on. */
  decisions: DecisionRecord[];
  question: ForcedChoice | null;
  cue: string | null;
  outward: OutwardLine[];
  farHeard: { text: string; t: number }[];
  simulation: { event: string; detail?: string; t: number }[];
  log: { message: string; t: number }[];
  events: ServerMessage[];
  complete: boolean;
  audit: CallAudit | null;
  auditFailed: string | null;
  /** The self-audit has started and not yet finished. */
  auditing: boolean;
};

const EMPTY_STATS: FloorModel['stats'] = { silenceProtectedMs: 0, holdsSpoken: 0, inventionsBlocked: 0, questionsAsked: 0, relays: 0 };

export const initialCallState: CallState = {
  status: 'idle', error: null, callId: null, farLeg: null, caller: 'The caller', lexicon: [], floor: 'IDLE', stats: EMPTY_STATS,
  partial: { patient: '', fast: '' }, patientTurns: [], fastTurns: [], evidence: null, dissent: null,
  decisions: [], question: null, cue: null, outward: [], farHeard: [], simulation: [], log: [],
  events: [], complete: false, audit: null, auditFailed: null, auditing: false,
};

type Action =
  | { type: 'status'; status: Status; error?: string }
  | { type: 'event'; m: ServerMessage }
  | { type: 'answered' }
  | { type: 'reset' };

export function reduceCall(s: CallState, a: Action): CallState {
  switch (a.type) {
    case 'reset': return initialCallState;
    case 'status': return { ...s, status: a.status, error: a.error ?? s.error };
    case 'answered': return { ...s, question: null };
    case 'event': break;
  }
  const m = a.m;
  const next: CallState = { ...s, events: [...s.events, m] };
  switch (m.type) {
    case 'ready': return { ...next, callId: m.callId, farLeg: m.farLeg, caller: m.caller, lexicon: m.lexicon, status: 'live' };
    case 'floor': return { ...next, floor: m.state, stats: m.stats, cue: m.state === 'USER_SPEAKING' ? null : next.cue };
    case 'turn': {
      const key = m.stream;
      const partial = { ...next.partial, [key]: m.turn.end_of_turn ? '' : m.turn.transcript };
      if (!m.turn.end_of_turn) return { ...next, partial };
      return key === 'patient'
        ? { ...next, partial, patientTurns: [...next.patientTurns, m.turn] }
        : { ...next, partial, fastTurns: [...next.fastTurns, m.turn] };
    }
    case 'evidence': return { ...next, evidence: m.evidence };
    case 'dissent': return { ...next, dissent: m.result, decisions: [...next.decisions, { result: m.result, evidence: next.evidence, t: m.t }] };
    case 'question': return { ...next, question: m.question };
    case 'cue': return { ...next, cue: m.text };
    case 'outward': return { ...next, outward: [...next.outward, { kind: m.kind, text: m.text, t: m.t, spoken: false }] };
    case 'agent_spoke': {
      const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      const said = norm(m.text);
      return { ...next, outward: next.outward.map((o) => (said.includes(norm(o.text)) ? { ...o, spoken: true } : o)) };
    }
    case 'agent_cut':
      return { ...next, outward: next.outward.map((o) => (m.texts.includes(o.text) && !o.cut ? { ...o, cut: true, spoken: false } : o)) };
    case 'far_heard': return { ...next, farHeard: [...next.farHeard, { text: m.text, t: m.t }] };
    case 'simulation':
      return {
        ...next,
        // The simulated caller answered the question on screen.
        ...(m.event === 'caller_chose' ? { question: null } : {}),
        simulation: [...next.simulation, { event: m.event, ...(m.detail ? { detail: m.detail } : {}), t: m.t }],
        complete: next.complete || m.event === 'call_complete',
      };
    case 'log': return { ...next, log: [...next.log, { message: m.message, t: m.t }], auditing: next.auditing || /^Grading this call/.test(m.message) };
    case 'audit': return { ...next, audit: m.audit, auditing: false };
    case 'audit_failed': return { ...next, auditFailed: m.message, auditing: false };
    case 'error': return { ...next, error: m.message };
    default: return next;
  }
}

export function useCall() {
  const [state, dispatch] = useReducer(reduceCall, initialCallState);
  const ws = useRef<WebSocket | null>(null);
  const player = useRef<Player | null>(null);
  const capture = useRef<Capture | null>(null);
  const levelRef = useRef(0);
  const farLegRef = useRef<CallState['farLeg']>(null);

  const teardown = useCallback(() => {
    capture.current?.stop();
    capture.current = null;
    ws.current?.close();
    ws.current = null;
    player.current?.close();
    player.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async (mode: Mode, opts: { grade?: boolean; scenario?: Scenario } = {}) => {
    teardown();
    dispatch({ type: 'reset' });
    dispatch({ type: 'status', status: 'connecting' });

    // Audio playback must be unlocked inside the click that started the call.
    const p = new Player();
    player.current = p;
    await p.resume();
    // In sample mode the caller is a recording, so the ring follows its audio.
    if (mode === 'sample') p.onLevel = (ch, rms) => { if (ch === 1) levelRef.current = rms; };

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl());
    } catch (err) {
      dispatch({ type: 'status', status: 'error', error: (err as Error).message });
      return;
    }
    socket.binaryType = 'arraybuffer';
    ws.current = socket;

    // Bring your own: the key, model and voice apply to any call. The profile and
    // words apply to live calls only; the recorded caller is always Robert.
    const settings = loadSettings();
    const { key } = loadKey();
    const hello = {
      type: 'hello', role: 'caller', mode, simulateFarParty: true,
      ...(mode === 'sample' && opts.scenario ? { scenario: opts.scenario } : {}),
      // Keep the caller's audio for the self-audit only if they said yes.
      ...(mode === 'live' && opts.grade ? { retainAudio: true } : {}),
      ...(key.trim() ? { apiKey: key.trim() } : {}),
      ...(settings.model ? { llmModel: settings.model } : {}),
      ...(settings.voice ? { voice: settings.voice } : {}),
      ...(mode === 'live' && hasProfile(settings) ? { profile: toProfile(settings), lexicon: settings.words } : {}),
    };

    socket.onopen = async () => {
      socket.send(JSON.stringify(hello));
      if (mode === 'live') {
        try {
          capture.current = await startCapture({
            targetRate: 16000,
            onFrame: (pcm) => { if (socket.readyState === WebSocket.OPEN) socket.send(pcm); },
            onLevel: (rms) => { levelRef.current = rms; },
          });
        } catch {
          dispatch({ type: 'status', status: 'error', error: 'Microphone unavailable. Try the recorded call instead.' });
        }
      }
    };
    socket.onmessage = (e) => {
      if (typeof e.data !== 'string') {
        p.play(e.data as ArrayBuffer);
        return;
      }
      const m = JSON.parse(e.data) as ServerMessage;
      if (m.type === 'ready') farLegRef.current = m.farLeg;
      // No Voice Agent (no public URL): speak approved lines in the browser, so
      // the demo never goes silent. The UI labels this as a fallback.
      if (m.type === 'outward' && farLegRef.current === 'browser') speakInBrowser(m.text);
      // The caller found the word mid-hold: the hold line stops at once.
      if (m.type === 'agent_cut') p.flush(3);
      dispatch({ type: 'event', m });
    };
    socket.onerror = () => dispatch({ type: 'status', status: 'error', error: `Could not reach the orchestrator at ${ORCHESTRATOR_URL}.` });
    socket.onclose = () => dispatch({ type: 'status', status: 'ended' });
  }, [teardown]);

  const send = useCallback((msg: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
  }, []);

  // Hang up. If the call is being graded, the server closes the socket once the
  // grade is sent, so wait for that (up to 30 seconds) before tearing down.
  const end = useCallback(() => {
    const s = ws.current;
    capture.current?.stop();
    capture.current = null;
    const done = () => { teardown(); dispatch({ type: 'status', status: 'ended' }); };
    if (!s || s.readyState !== WebSocket.OPEN) { done(); return; }
    dispatch({ type: 'status', status: 'ending' });
    s.send(JSON.stringify({ type: 'end' }));
    const timer = setTimeout(done, 30000);
    s.addEventListener('close', () => { clearTimeout(timer); done(); }, { once: true });
  }, [teardown]);

  return {
    state,
    start,
    end,
    level: levelRef,
    choose: (q: ForcedChoice, optionId: string) => {
      const label = q.options.find((o) => o.id === optionId)?.label ?? '';
      send({ type: 'choice', questionId: q.id, optionId, label });
      dispatch({ type: 'answered' });
    },
    somethingElse: () => { send({ type: 'something_else' }); dispatch({ type: 'answered' }); },
    stop: () => send({ type: 'stop' }),
    escalate: () => send({ type: 'escalate' }),
  };
}
