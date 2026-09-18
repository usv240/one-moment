// Numbers the site shows. Each is either computed at build time from a
// recorded artifact in this repository, or copied from a dated measurement
// with the script that produced it. Nothing here is typed as a target.

import recorded from './recorded-call.json';
import recordedChoice from './recorded-call-choice.json';
import type { ServerMessage } from '@one-moment/core';
import type { Recording } from '@/lib/replay';

export const RECORDING = recorded as unknown as Recording;
/** The harder call: the medicine name only half comes out, so it asks. */
export const RECORDING_CHOICE = recordedChoice as unknown as Recording;

const ev = RECORDING.events as ServerMessage[];
const find = <T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true) =>
  ev.find((m): m is Extract<ServerMessage, { type: T }> => m.type === type && pred(m as Extract<ServerMessage, { type: T }>));

const decision = find('dissent');
const cut = find('agent_cut');
const relay = find('outward', (m) => m.kind === 'relay');
const earlyEnd = find('log', (m) => /finished sentence/.test(m.message));
const patientFinal = find('turn', (m) => m.stream === 'patient' && m.turn.end_of_turn);
const audit = find('audit')?.audit ?? null;

/** From the recorded demo call. */
export const CALL = {
  recordedAt: RECORDING.recordedAt,
  durationS: Math.round(RECORDING.durationMs / 100) / 10,
  decisionMs: decision?.result.timings.totalMs ?? null,
  modelCalls: decision && decision.result.model === null && decision.result.advocate === null ? 0 : null,
  holdCut: Boolean(cut),
  earlyEnd: Boolean(earlyEnd),
  relayText: relay?.text ?? null,
  patientTranscript: patientFinal?.turn.transcript ?? null,
  /** The self-audit of the recorded call, from AssemblyAI's pre-recorded API. */
  audit,
};

/**
 * Measured 17 and 18 September 2026 against the live API.
 * Scripts: eval/spike/tests/01-dual-stream.js (second stream), 02-patience.js
 * (turns), 04-confidence.js (gaps), eval/proofs/voice-agent-verbatim.mjs. The
 * silence estimate is a unit test on the recorded live word timings:
 * packages/core/test/evidence.test.ts.
 */
/**
 * Measured 18 September 2026, eval/probe-vocabulary.mjs: four slurred ways of
 * saying "amlodipine", each through both ears. The patient ear carried the
 * caller's vocabulary; the fast ear did not.
 */
export const VOCABULARY = {
  variants: 4,
  boostedHeardTerm: 4,
  unbiasedHeardTerm: 0,
  examples: [
    { said: 'am low dippy', boosted: 'amlodipine', unbiased: 'AMLO Dippy' },
    { said: 'amla deepin', boosted: 'amlodipine', unbiased: 'Amla Deepin' },
    { said: 'amblo, dipine', boosted: 'amlodipine', unbiased: 'amblyodipine' },
    { said: 'um, am, am lo', boosted: 'um, amlodipine', unbiased: 'um, am. Am. Am low' },
  ],
};

export const SPIKE = {
  pauseMs: 6020,
  defaultTurns: 2,
  patientTurns: 1,
  defaultSplit: ['I need to refill my...', 'amlodipine prescription please.'],
  patientHeld: 'I need to refill my amlodipine prescription, please.',
  secondStreamMs: -67,
  realtimeGapMs: 46,
  recoveredMs: 7186,
  actualMs: 7220,
};
