// Evidence assembly.
//
// Streaming speech recognition returns a time series, not a string. This module
// turns the raw Turn messages from both streams into the bundle Dissent reasons
// over. Most voice agents keep `transcript` and throw the rest away. The rest is
// the product.

import type { EvidenceBundle, LexiconHit, LexiconTerm, StreamTurn, Word } from './types.ts';
import { alignTokens, normalizeTokens } from './align.ts';

export type EvidenceOptions = {
  /** A word whose excess duration passes this probably contains a swallowed pause. */
  blockExcessMs?: number;
  /** Words below this confidence are listed for the Skeptic. */
  lowConfidence?: number;
  /** Fast-stream words this far outside the patient turn's window are ignored. */
  windowSlackMs?: number;
};

const DEFAULTS: Required<EvidenceOptions> = {
  blockExcessMs: 1200,
  lowConfidence: 0.6,
  windowSlackMs: 300,
};

/**
 * Expected duration of a word spoken at a typical rate, from its letter count.
 *
 * MEASURED 17 Sept against the live realtime API: a mid-turn silence is not
 * exposed as an inter-word gap. A 6020ms pause produced uniform 46ms gaps, with
 * the silence absorbed into the durations of the words around it. Summing each
 * word's excess over this prior recovered 7186ms of non-speech from a clip that
 * contained 7220ms, an error of 0.5 percent.
 *
 * Calibrated on synthetic speech at a normal rate. Slow dysarthric articulation
 * lengthens words for reasons other than silence and will inflate the estimate.
 * The self-audit loop recalibrates this prior against the pre-recorded API,
 * which does expose real gaps.
 */
export const expectedWordMs = (text: string): number => 60 * text.replace(/[^a-z]/gi, '').length + 100;

export function wordExcessMs(w: Word): number {
  return Math.max(0, w.end - w.start - expectedWordMs(w.text));
}

/** Estimated silence hidden inside a turn's word durations. */
export function swallowedSilenceMs(words: Word[]): number {
  return words.reduce((sum, w) => sum + wordExcessMs(w), 0);
}

/**
 * Counts how often a partial hypothesis was revised rather than extended.
 * A recogniser that keeps changing its mind is telling you the audio is ambiguous.
 */
export class ChurnTracker {
  private last = new Map<number, string>();
  private counts = new Map<number, number>();

  observe(turn: Pick<StreamTurn, 'turn_order' | 'transcript'>): void {
    const prev = this.last.get(turn.turn_order);
    const next = normalizeTokens(turn.transcript).join(' ');
    if (prev !== undefined && next && !next.startsWith(prev)) {
      this.counts.set(turn.turn_order, (this.counts.get(turn.turn_order) ?? 0) + 1);
    }
    this.last.set(turn.turn_order, next);
  }

  churn(turnOrder: number): number {
    return this.counts.get(turnOrder) ?? 0;
  }
}

/**
 * Fast-stream words that fall inside the time window of a patient turn.
 * Both streams receive identical audio from the same start, so timestamps are
 * comparable. The patient stream holds a turn open across a pause that the fast
 * stream splits, so the fast side must be gathered by time, not by turn number.
 */
export function fastWordsInWindow(patient: StreamTurn, fastFinals: StreamTurn[], slackMs: number): Word[] {
  if (!patient.words.length) return [];
  const from = patient.words[0]!.start - slackMs;
  const to = patient.words[patient.words.length - 1]!.end + slackMs;
  return fastFinals
    .flatMap((t) => t.words)
    .filter((w) => w.start >= from && w.end <= to)
    .sort((a, b) => a.start - b.start);
}

export function lexiconHits(patientText: string, fastText: string | null, lexicon: LexiconTerm[]): LexiconHit[] {
  const p = ` ${normalizeTokens(patientText).join(' ')} `;
  const f = fastText === null ? null : ` ${normalizeTokens(fastText).join(' ')} `;
  const hits: LexiconHit[] = [];
  for (const entry of lexicon) {
    const forms = [entry.term, ...(entry.aliases ?? [])].map((x) => ` ${normalizeTokens(x).join(' ')} `);
    if (forms.some((form) => p.includes(form))) {
      hits.push({ term: entry.term, confirmedByFast: f !== null && forms.some((form) => f.includes(form)) });
    }
  }
  return hits;
}

export function assembleEvidence(args: {
  patient: StreamTurn;
  fastFinals?: StreamTurn[];
  lexicon?: LexiconTerm[];
  churn?: number;
  options?: EvidenceOptions;
}): EvidenceBundle {
  const o = { ...DEFAULTS, ...args.options };
  const { patient } = args;
  const words = patient.words ?? [];

  const fastWords = args.fastFinals ? fastWordsInWindow(patient, args.fastFinals, o.windowSlackMs) : null;
  const fastTranscript = fastWords ? fastWords.map((w) => w.text).join(' ') : null;

  const durations = words.map((w) => w.end - w.start);
  const gaps = words.slice(1).map((w, i) => w.start - words[i]!.end);
  const confs = words.map((w) => w.confidence).filter((c) => typeof c === 'number');

  return {
    turnOrder: patient.turn_order,
    endOfTurn: patient.end_of_turn,
    patientTranscript: patient.transcript,
    fastTranscript,
    words,
    durations,
    longestWordMs: durations.length ? Math.max(...durations) : 0,
    blockWords: words
      .map((w, index) => ({ text: w.text, ms: wordExcessMs(w), index }))
      .filter((b) => b.ms >= o.blockExcessMs),
    largestGapMs: gaps.length ? Math.max(...gaps) : 0,
    minConfidence: confs.length ? Math.min(...confs) : null,
    meanConfidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
    lowConfidenceWords: words
      .map((w, index) => ({ text: w.text, confidence: w.confidence, index }))
      .filter((w) => w.confidence < o.lowConfidence),
    disagreement:
      fastTranscript === null
        ? []
        : alignTokens(normalizeTokens(patient.transcript), normalizeTokens(fastTranscript)),
    churn: args.churn ?? 0,
    lexiconHits: lexiconHits(patient.transcript, fastTranscript, args.lexicon ?? []),
  };
}
