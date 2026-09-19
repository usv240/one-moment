// The wire protocol between the browser and the orchestrator.
//
// Audio travels as binary WebSocket frames: 16kHz mono PCM16, 50ms per frame.
// Everything else is JSON. Every server message carries a monotonic `seq` and
// a server timestamp `t`, so a call can be replayed exactly from stored events
// rather than re-simulated.

import type { DissentResult, EvidenceBundle, ForcedChoice, LexiconTerm, StreamTurn } from './types.ts';
import type { FloorModel, FloorState } from './floor.ts';

export type Role = 'caller' | 'far';

export type CallerProfile = {
  displayName: string;
  pronoun: 'he' | 'she' | 'they';
  /** Result of the YNQ-style calibration. Unknown means fall back to forced choice. */
  yesNoReliability: 'reliable' | 'unreliable' | 'unknown';
  context?: string;
};

export type ClientMessage =
  | {
      type: 'hello';
      role: Role;
      callId?: string;
      profile?: CallerProfile;
      lexicon?: LexiconTerm[];
      retainAudio?: boolean;
      /**
       * live: the browser microphone is the caller.
       * sample: the server plays a recorded caller, so a judge can hear a full
       * call with no microphone and no second person.
       */
      mode?: 'live' | 'sample';
      /**
       * Which recorded caller, in sample mode. pause: a clear sentence with a
       * 6-second block. choice: the medicine name is slurred, so the ears
       * disagree about it and the caller is asked (and a simulated tap answers).
       */
      scenario?: 'pause' | 'choice';
      /** A simulated pharmacist who speaks up when the caller pauses mid-turn. Labelled as simulated in the UI. */
      simulateFarParty?: boolean;
      /**
       * Bring your own key: the caller's AssemblyAI key, used for this call only.
       * Held in memory by the orchestrator for the length of the call, never
       * logged, never stored, never sent anywhere but AssemblyAI.
       */
      apiKey?: string;
      /** Bring your own model: an LLM Gateway model id for Dissent. */
      llmModel?: string;
      /** Bring your own voice: which AssemblyAI voice speaks for the caller. Checked against VOICES. */
      voice?: string;
    }
  | { type: 'choice'; questionId: string; optionId: string; label: string }
  | { type: 'something_else'; questionId?: string }
  | { type: 'stop' }
  | { type: 'escalate' }
  | { type: 'end' };

type Stamp = { seq: number; t: number };

export type ServerMessage = Stamp & (
  | { type: 'ready'; callId: string; role: Role; streams: { patient: string; fast: string }; farLeg: 'voice-agent' | 'browser'; caller: string; lexicon: string[] }
  | { type: 'simulation'; event: 'caller_sample_started' | 'caller_sample_ended' | 'pharmacist_spoke' | 'caller_chose' | 'call_complete'; detail?: string }
  | { type: 'partial'; stream: 'patient' | 'fast'; text: string }
  | { type: 'turn'; stream: 'patient' | 'fast'; turn: StreamTurn }
  | { type: 'evidence'; evidence: EvidenceBundle }
  | { type: 'floor'; state: FloorState; stats: FloorModel['stats'] }
  | { type: 'dissent'; result: DissentResult }
  | { type: 'question'; question: ForcedChoice }
  | { type: 'outward'; kind: 'disclosure' | 'hold' | 'relay'; text: string }
  /** What the Voice Agent actually said, from AssemblyAI's own transcript.agent. Proof, not intent. */
  | { type: 'agent_spoke'; text: string }
  /** The caller resumed mid-hold: the orchestrator stopped the agent's audio. Browsers flush channel 3. */
  | { type: 'agent_cut'; texts: string[] }
  | { type: 'far_heard'; text: string }
  | { type: 'cue'; text: string }
  | { type: 'escalated'; reason: string; packet: EscalationPacket }
  /** After the call: graded against AssemblyAI's pre-recorded transcript of the same audio. */
  | { type: 'audit'; audit: CallAudit }
  | { type: 'audit_failed'; message: string }
  | { type: 'log'; message: string }
  | { type: 'error'; message: string }
);

/** The self-audit: the live call checked against a careful transcript of its own audio. */
export type CallAudit = {
  /** The pre-recorded model that produced the careful transcript. */
  model: string;
  /** How long grading took, upload to result. */
  ms: number;
  carefulText: string;
  /** The longest pause: as the careful model heard it, as the live stream reported it, and as we estimated it. */
  pause: { carefulMs: number | null; liveGapMs: number | null; estimatedMs: number | null };
  /**
   * Every relayed line, and whether each of its words was confirmed: by the
   * careful transcript, or by the caller's own tap on a choice (byChoice).
   */
  relays: { said: string; confirmed: boolean; missing: string[]; byChoice: string[] }[];
  /** Word-level disagreement between the live patient transcript and the careful one, 0 to 1. */
  drift: number | null;
  verdict: string;
  allConfirmed: boolean;
};

/** Handed to a human relay assistant so they never start from zero. */
export type EscalationPacket = {
  callId: string;
  caller: string;
  elapsedMs: number;
  established: { text: string; at: number }[];
  unresolved: string | null;
  competingReadings: { advocate: string | null; skeptic: string | null };
  transcript: { speaker: 'caller' | 'far' | 'agent'; text: string; at: number }[];
  lexiconActive: string[];
  yesNoReliability: CallerProfile['yesNoReliability'];
  suggestedQuestion: ForcedChoice | null;
};
