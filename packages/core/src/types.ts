// Shared types for the One Moment engine.
//
// Field names on Word and StreamTurn mirror the AssemblyAI Universal-Streaming
// Turn message exactly, so a raw server message can be passed straight in.

export type Word = {
  text: string;
  start: number;          // ms from stream start
  end: number;            // ms from stream start
  confidence: number;     // 0..1, present on partials as well as finals (measured)
  word_is_final?: boolean;
  speaker?: string;
};

/** A Turn message from an AssemblyAI streaming session, as received. */
export type StreamTurn = {
  type: 'Turn';
  turn_order: number;
  end_of_turn: boolean;
  /** Binary on Universal-3.5 Pro: 1 on end of turn, 0 otherwise. Measured. */
  end_of_turn_confidence?: number;
  turn_is_formatted?: boolean;
  transcript: string;
  utterance?: string;
  words: Word[];
  speaker_label?: string;
  language_code?: string;
};

export type StreamName = 'patient' | 'fast';

/** One position where the two streams heard different things. */
export type Disagreement = {
  index: number;
  patient: string | null;
  fast: string | null;
  kind: 'substitution' | 'patient_only' | 'fast_only';
};

export type LexiconTerm = {
  term: string;
  category?: 'medication' | 'pharmacy' | 'doctor' | 'family' | 'place' | 'phrase' | 'other';
  aliases?: string[];
};

export type LexiconHit = {
  term: string;
  /** Did the unboosted fast stream independently hear it? If not, the boost may have forced it. */
  confirmedByFast: boolean;
};

/**
 * Everything the Skeptic and the Adjudicator are allowed to reason over.
 * Dissent never works on a bare string.
 */
export type EvidenceBundle = {
  turnOrder: number;
  endOfTurn: boolean;
  patientTranscript: string;
  fastTranscript: string | null;
  words: Word[];
  /** Word durations in ms. A mid-turn silence is absorbed into these, not exposed as a gap. */
  durations: number[];
  longestWordMs: number;
  /** Words whose duration marks a swallowed pause, i.e. a probable word-finding block. */
  blockWords: { text: string; ms: number; index: number }[];
  largestGapMs: number;
  minConfidence: number | null;
  meanConfidence: number | null;
  lowConfidenceWords: { text: string; confidence: number; index: number }[];
  disagreement: Disagreement[];
  churn: number;
  lexiconHits: LexiconHit[];
};

export type SpanBasis = 'audio' | 'profile' | 'context' | 'inference';

export type AdvocateOutput = {
  say: string;
  polarity: 'affirmative' | 'negative';
  guessed: string[];
};

/**
 * The Skeptic gives its own independent, cautious reading of the same evidence.
 * Where its polarity differs from the Advocate's, the system asks. Two
 * independent readings and a rule about their disagreement: the same principle
 * as the two listening streams, one level up.
 */
export type SkepticOutput = {
  negationRisk: boolean;
  unsupported: string[];
  polarity: 'affirmative' | 'negative';
  reading: string;
};

export type Decision =
  | { action: 'relay'; text: string; policyRule: number; reason: 'grounded' | 'verbatim' }
  | { action: 'ask'; policyRule: number; reason: string; target?: string }
  | { action: 'hold'; policyRule: number; reason: string };

export type DissentResult = {
  advocate: AdvocateOutput | null;
  skeptic: SkepticOutput | null;
  deterministic: DeterministicFindings;
  decision: Decision;
  timings: { advocateMs: number | null; skepticMs: number | null; totalMs: number };
  model: string | null;
};

/** Checks that run without any model, and therefore cannot be talked out of a finding. */
export type DeterministicFindings = {
  negationInEvidence: boolean;
  negationDisputed: boolean;
  invented: string[];
  polarityMismatch: boolean;
};

export type ForcedChoice = {
  id: string;
  prompt: string;
  /**
   * `label` is what the caller sees: at most four words. `relay` is the full,
   * grounded sentence spoken to the far party if this option is chosen. The
   * caller taps "Stop it"; the pharmacist hears "He wants to stop the tablet."
   */
  options: { id: string; label: string; icon?: string; relay?: string }[];
  allowSomethingElse: true;
};
