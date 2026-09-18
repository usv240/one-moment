// Test fixtures taken from real runs against the live AssemblyAI API on
// 17 September 2026, not invented values. See spike/REPORT.md.

import type { StreamTurn, Word } from '../src/types.ts';

/**
 * pause-6s.wav through the patient configuration (Universal-3.5 Pro,
 * mode=max_accuracy, min_turn_silence=6000, max_turn_silence=9000).
 * The clip is 0.4s lead + speech + a 6020ms mid-sentence pause + 0.8s tail.
 * Note the uniform 46ms gaps: the silence is absorbed into word durations.
 */
export const PATIENT_PAUSE_6S: StreamTurn = {
  type: 'Turn',
  turn_order: 0,
  end_of_turn: true,
  end_of_turn_confidence: 1,
  turn_is_formatted: true,
  transcript: 'I need to refill my amlodipine prescription, please.',
  words: [
    { text: 'I', start: 0, end: 234, confidence: 0.999, word_is_final: true },
    { text: 'need', start: 280, end: 1219, confidence: 1.0, word_is_final: true },
    { text: 'to', start: 1265, end: 1734, confidence: 1.0, word_is_final: true },
    { text: 'refill', start: 1780, end: 3189, confidence: 1.0, word_is_final: true },
    { text: 'my', start: 3235, end: 3704, confidence: 1.0, word_is_final: true },
    { text: 'amlodipine', start: 3750, end: 6099, confidence: 0.995, word_is_final: true },
    { text: 'prescription,', start: 6145, end: 9198, confidence: 0.961, word_is_final: true },
    { text: 'please.', start: 9244, end: 10888, confidence: 0.998, word_is_final: true },
  ],
};

/** Actual non-speech in that clip: 400 lead + 6020 pause + 800 tail. */
export const PAUSE_6S_NON_SPEECH_MS = 7220;

/** The same clip through server defaults split into two turns at the pause. */
export const BASELINE_SPLIT = [
  'I need to refill my...',
  'amlodipine prescription please.',
];

export const w = (text: string, start: number, end: number, confidence = 0.95): Word => ({
  text, start, end, confidence, word_is_final: true,
});

/** Build a final turn from plain words with even timing. */
export function turn(text: string, opts: { order?: number; conf?: number; start?: number; final?: boolean } = {}): StreamTurn {
  const toks = text.split(/\s+/).filter(Boolean);
  let t = opts.start ?? 400;
  const words = toks.map((tok) => {
    const word = w(tok, t, t + 300, opts.conf ?? 0.95);
    t += 350;
    return word;
  });
  return {
    type: 'Turn',
    turn_order: opts.order ?? 0,
    end_of_turn: opts.final ?? true,
    end_of_turn_confidence: opts.final === false ? 0 : 1,
    transcript: text,
    words,
  };
}

/**
 * Three real inversions from the first NEGBENCH run on Harvard Sentences
 * (IEEE Std 297-1969). The baseline model relayed each with its meaning flipped.
 */
export const HARVARD_INVERSIONS = [
  { truth: 'An abrupt start does not win the prize', degraded: 'an abrupt start does win the prize', baseline: 'An abrupt start does win the prize' },
  { truth: 'Hats are worn to tea and not to dinner', degraded: 'hats are worn to tea and to dinner', baseline: 'Hats are worn to tea and dinner.' },
  { truth: "Cheap clothes are flashy but don't last", degraded: 'cheap clothes are flashy but last', baseline: 'The clothes are flashy but last long.' },
];
