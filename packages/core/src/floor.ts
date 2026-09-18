// The Floor Controller.
//
// The component that makes this a conversation partner rather than a
// transcription tool. A pure, deterministic reducer: (state, event) -> (state,
// actions). No model decides who may speak. Every transition is testable.
//
// Its one question: who is entitled to speak right now, and what do we do to
// protect that?

import type { DissentResult, EvidenceBundle, ForcedChoice } from './types.ts';

export type FloorState =
  | 'IDLE' | 'USER_SPEAKING' | 'USER_PAUSED' | 'HOLDING' | 'DECIDING'
  | 'CLARIFYING' | 'RELAYING' | 'FAR_SPEAKING' | 'ESCALATE';

export type FloorEvent =
  | { type: 'user_speech'; at: number }
  | { type: 'user_turn_final'; at: number; evidence: EvidenceBundle }
  | { type: 'far_speech'; at: number }
  | { type: 'far_turn_final'; at: number; text: string }
  | { type: 'tick'; at: number }
  | { type: 'dissent'; at: number; result: DissentResult; question?: ForcedChoice }
  | { type: 'choice'; at: number; label: string }
  | { type: 'something_else'; at: number }
  | { type: 'stop'; at: number }
  | { type: 'outward_done'; at: number }
  /** The caller resumed while a hold line was playing, so it was cut off. */
  | { type: 'outward_cut'; at: number; disclosureLost: boolean }
  | { type: 'escalate_request'; at: number };

export type FloorAction =
  /** `discloses` marks the line that tells the far party an assistant is on the call. */
  | { type: 'say_far'; kind: 'disclosure' | 'hold' | 'relay'; text: string; discloses?: boolean }
  | { type: 'cue_user'; text: string }
  | { type: 'ask_user'; question: ForcedChoice }
  | { type: 'run_dissent'; evidence: EvidenceBundle }
  | { type: 'cancel_outward' }
  | { type: 'escalate'; reason: string }
  | { type: 'log'; message: string };

export type FloorConfig = {
  /** Silence after which we start protecting the floor, even before the far party speaks. */
  holdAfterMs: number;
  /** Minimum gap between two outward hold lines, so we do not talk over the far party. */
  holdCooldownMs: number;
  /** Consecutive unresolved questions before handing to a human. */
  maxUnresolved: number;
  /** Silence before a gentle in-ear cue. Never a countdown, never "are you still there". */
  cueAfterMs: number;
  userName: string;
  pronoun: 'he' | 'she' | 'they';
};

export const DEFAULT_FLOOR_CONFIG: FloorConfig = {
  holdAfterMs: 2500,
  holdCooldownMs: 6000,
  maxUnresolved: 3,
  cueAfterMs: 8000,
  userName: 'the caller',
  pronoun: 'they',
};

export type FloorModel = {
  state: FloorState;
  userTurnOpen: boolean;
  lastUserSpeechAt: number | null;
  lastHoldAt: number | null;
  holdIndex: number;
  disclosed: boolean;
  unresolved: number;
  cued: boolean;
  pendingQuestion: ForcedChoice | null;
  /** Metrics the Observer View shows live. */
  stats: { silenceProtectedMs: number; holdsSpoken: number; inventionsBlocked: number; questionsAsked: number; relays: number };
};

export const initialFloor = (): FloorModel => ({
  state: 'IDLE',
  userTurnOpen: false,
  lastUserSpeechAt: null,
  lastHoldAt: null,
  holdIndex: 0,
  disclosed: false,
  unresolved: 0,
  cued: false,
  pendingQuestion: null,
  stats: { silenceProtectedMs: 0, holdsSpoken: 0, inventionsBlocked: 0, questionsAsked: 0, relays: 0 },
});

/**
 * Rotating hold lines. Never the same one twice in a row, because repetition is
 * what makes an automated system obviously automated. Short, never apologetic in
 * a way that diminishes the user, and never explains the user's condition.
 */
export function holdLines(c: FloorConfig): string[] {
  const s = c.pronoun === 'she' ? "She's" : c.pronoun === 'he' ? "He's" : "They're";
  const o = c.pronoun === 'she' ? 'her' : c.pronoun === 'he' ? 'him' : 'them';
  const n = c.pronoun === 'she' ? "she's" : c.pronoun === 'he' ? "he's" : "they're";
  return [
    `${s} still with you. One moment.`,
    `One moment please, ${n} not finished.`,
    `Still here. Give ${o} a moment please.`,
    `Just a moment, ${n} finding the word.`,
  ];
}

/**
 * Said once, on the first outward words of every call. Never claims to be the
 * caller. Kept short on purpose: MEASURED 18 Sept, a two-sentence disclosure
 * plus a hold line ran about 6 seconds, long enough to overlap the caller when
 * they resumed. Every word here is a word the caller cannot speak over.
 */
export function disclosureLine(c: FloorConfig): string {
  return `Hi, I'm an assistant on this call with ${c.userName}.`;
}

/**
 * The first hold of a call, which is also the disclosure. MEASURED 18 Sept on a
 * recorded call: a separate disclosure followed by a hold line took about 4
 * seconds to say and was still playing when the caller found the word and
 * resumed. So the words that make the far party wait come first, and the
 * disclosure rides in the same breath.
 */
export function firstHoldLine(c: FloorConfig): string {
  const n = c.pronoun === 'she' ? "she's" : c.pronoun === 'he' ? "he's" : "they're";
  const p = c.pronoun === 'she' ? 'her' : c.pronoun === 'he' ? 'his' : 'their';
  return `One moment please, ${n} still with you. I'm ${p} assistant.`;
}

export function stepFloor(m: FloorModel, e: FloorEvent, c: FloorConfig = DEFAULT_FLOOR_CONFIG): { model: FloorModel; actions: FloorAction[] } {
  const next: FloorModel = { ...m, stats: { ...m.stats } };
  const actions: FloorAction[] = [];

  // Once a human relay assistant has the call, the agent stays out of it. The
  // only thing still honoured is Stop, because the user must always be able to
  // halt speech made in their name. (Found by test: a stray "something else"
  // tap was pulling the agent back into a call a human had taken over.)
  if (m.state === 'ESCALATE') {
    if (e.type === 'stop') actions.push({ type: 'cancel_outward' });
    return { model: next, actions };
  }

  const hold = (at: number, reason: string) => {
    if (next.lastHoldAt !== null && at - next.lastHoldAt < c.holdCooldownMs) return;
    if (!next.disclosed) {
      actions.push({ type: 'say_far', kind: 'hold', text: firstHoldLine(c), discloses: true });
      next.disclosed = true;
    } else {
      const lines = holdLines(c);
      actions.push({ type: 'say_far', kind: 'hold', text: lines[next.holdIndex % lines.length]! });
    }
    next.holdIndex++;
    next.lastHoldAt = at;
    next.stats.holdsSpoken++;
    next.state = 'HOLDING';
    actions.push({ type: 'log', message: `holding the floor: ${reason}` });
  };

  switch (e.type) {
    case 'user_speech': {
      if (next.lastUserSpeechAt !== null && next.userTurnOpen) {
        next.stats.silenceProtectedMs += Math.max(0, e.at - next.lastUserSpeechAt);
      }
      next.lastUserSpeechAt = e.at;
      next.userTurnOpen = true;
      next.cued = false;
      if (next.state !== 'CLARIFYING' && next.state !== 'RELAYING') next.state = 'USER_SPEAKING';
      break;
    }

    case 'tick': {
      if (!next.userTurnOpen || next.lastUserSpeechAt === null) break;
      const silent = e.at - next.lastUserSpeechAt;
      if (silent >= c.holdAfterMs && next.state === 'USER_SPEAKING') next.state = 'USER_PAUSED';
      if (silent >= c.cueAfterMs && !next.cued && next.state !== 'CLARIFYING') {
        next.cued = true;
        actions.push({ type: 'cue_user', text: 'Take your time.' });
      }
      break;
    }

    case 'far_speech': {
      // The far party is about to take the floor while the user's turn is still
      // open. This is the moment the product exists for.
      if (next.userTurnOpen && next.state !== 'RELAYING') hold(e.at, 'far party spoke while the user was mid-turn');
      else if (next.state !== 'RELAYING') next.state = 'FAR_SPEAKING';
      break;
    }

    case 'far_turn_final': {
      if (!next.userTurnOpen && next.state !== 'RELAYING' && next.state !== 'CLARIFYING') next.state = 'IDLE';
      break;
    }

    case 'user_turn_final': {
      if (next.lastUserSpeechAt !== null) {
        next.stats.silenceProtectedMs += Math.max(0, e.at - next.lastUserSpeechAt);
      }
      next.userTurnOpen = false;
      next.state = 'DECIDING';
      actions.push({ type: 'run_dissent', evidence: e.evidence });
      break;
    }

    case 'dissent': {
      const d = e.result.decision;
      if (d.action === 'hold') {
        next.state = 'USER_PAUSED';
        next.userTurnOpen = true;
        break;
      }
      if (d.action === 'relay') {
        if (!next.disclosed) {
          actions.push({ type: 'say_far', kind: 'disclosure', text: disclosureLine(c), discloses: true });
          next.disclosed = true;
        }
        actions.push({ type: 'say_far', kind: 'relay', text: d.text });
        next.state = 'RELAYING';
        next.unresolved = 0;
        next.stats.relays++;
        break;
      }
      // ask
      if (d.policyRule >= 1 && d.policyRule <= 3) next.stats.inventionsBlocked++;
      next.unresolved++;
      if (next.unresolved >= c.maxUnresolved) {
        next.state = 'ESCALATE';
        actions.push({ type: 'escalate', reason: `${next.unresolved} consecutive unresolved turns` });
        break;
      }
      if (e.question) {
        next.pendingQuestion = e.question;
        next.state = 'CLARIFYING';
        next.stats.questionsAsked++;
        actions.push({ type: 'ask_user', question: e.question });
      }
      break;
    }

    case 'choice': {
      if (next.state !== 'CLARIFYING') break;
      next.pendingQuestion = null;
      next.unresolved = 0;
      if (!next.disclosed) {
        actions.push({ type: 'say_far', kind: 'disclosure', text: disclosureLine(c), discloses: true });
        next.disclosed = true;
      }
      // The person chose it, so it is grounded by their assent, not by inference.
      actions.push({ type: 'say_far', kind: 'relay', text: e.label });
      next.state = 'RELAYING';
      next.stats.relays++;
      break;
    }

    case 'something_else': {
      next.pendingQuestion = null;
      next.state = 'USER_SPEAKING';
      next.userTurnOpen = true;
      next.lastUserSpeechAt = e.at;
      actions.push({ type: 'cue_user', text: 'Okay. Tell me again, in your own time.' });
      break;
    }

    case 'stop': {
      // The user's ability to halt speech made in their name is non-negotiable.
      actions.push({ type: 'cancel_outward' });
      next.state = next.userTurnOpen ? 'USER_SPEAKING' : 'IDLE';
      break;
    }

    case 'outward_cut': {
      // The caller found the word. They have the floor; the hold is over. If the
      // cut line carried the disclosure, the far party may not have heard it,
      // so the next thing said on the caller's behalf discloses again.
      if (e.disclosureLost) next.disclosed = false;
      if (next.state === 'HOLDING') next.state = next.userTurnOpen ? 'USER_SPEAKING' : 'IDLE';
      actions.push({ type: 'log', message: 'The caller spoke again, so the hold line was cut off. The caller always has the floor.' });
      break;
    }

    case 'outward_done': {
      if (next.state === 'RELAYING') next.state = 'IDLE';
      else if (next.state === 'HOLDING') next.state = next.userTurnOpen ? 'USER_PAUSED' : 'IDLE';
      break;
    }

    case 'escalate_request': {
      next.state = 'ESCALATE';
      actions.push({ type: 'escalate', reason: 'user asked for a person' });
      break;
    }
  }

  return { model: next, actions };
}
