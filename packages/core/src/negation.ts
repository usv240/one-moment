// Deterministic negation checks.
//
// MEASURED, first NEGBENCH run, 18 Sept: a Skeptic reading a transcript cannot
// detect a negation that is no longer in the transcript. When "not" is dropped
// by the recogniser it is gone before any model sees the text. Every refusal in
// that run came from the confidence floor, not from the Skeptic.
//
// So the defence against a dropped negation lives here, in code that reads the
// evidence layer: a negator one stream heard and the other did not, a negator
// at low confidence, or a swallowed pause next to a negator. None of these can
// be argued away by a model.

import type { EvidenceBundle } from './types.ts';
import { normalizeTokens } from './align.ts';

/**
 * Words whose presence flips polarity. `stop` and `cancel` are deliberately
 * absent: they are usually verbs, and treating them as negators produced a
 * scorer false positive ("stop it from sinking" relayed as "prevent it from
 * sinking" was counted as an inversion).
 */
export const NEGATORS = new Set([
  'not', 'no', 'never', 'nothing', 'none', 'nobody', 'nowhere', 'neither', 'nor', 'without',
  "don't", 'dont', "doesn't", 'doesnt', "didn't", 'didnt', "won't", 'wont', "can't", 'cant',
  'cannot', "isn't", 'isnt', "aren't", 'arent', "wasn't", 'wasnt', "shouldn't", 'shouldnt',
  "wouldn't", 'wouldnt', "couldn't", 'couldnt', "haven't", 'havent', "hasn't", 'hasnt',
]);

export const hasNegator = (text: string): boolean => normalizeTokens(text).some((t) => NEGATORS.has(t));

export const polarityOf = (text: string): 'affirmative' | 'negative' =>
  hasNegator(text) ? 'negative' : 'affirmative';

export type NegationAssessment = {
  /** A negator is present in at least one stream. */
  present: boolean;
  /** The two streams disagree about a negator, so polarity itself is uncertain. */
  disputed: boolean;
  /** A negator was heard, but at low confidence. */
  lowConfidence: boolean;
  reasons: string[];
};

export function assessNegation(ev: EvidenceBundle, lowConfidence = 0.6): NegationAssessment {
  const reasons: string[] = [];
  const inPatient = hasNegator(ev.patientTranscript);
  const inFast = ev.fastTranscript !== null && hasNegator(ev.fastTranscript);

  const disputedAt = ev.disagreement.filter(
    (d) => (d.patient !== null && NEGATORS.has(d.patient)) || (d.fast !== null && NEGATORS.has(d.fast)),
  );
  if (disputedAt.length) {
    reasons.push(
      `streams disagree about a negator: ${disputedAt
        .map((d) => `patient="${d.patient ?? '-'}" fast="${d.fast ?? '-'}"`)
        .join(', ')}`,
    );
  }
  if (inPatient !== inFast && ev.fastTranscript !== null) {
    reasons.push(`only the ${inPatient ? 'patient' : 'fast'} stream heard a negation`);
  }

  const lowNeg = ev.words.filter(
    (w) => NEGATORS.has(normalizeTokens(w.text)[0] ?? '') && w.confidence < lowConfidence,
  );
  if (lowNeg.length) {
    reasons.push(`negator heard at low confidence: ${lowNeg.map((w) => `"${w.text}" ${w.confidence.toFixed(2)}`).join(', ')}`);
  }

  return {
    present: inPatient || inFast,
    disputed: disputedAt.length > 0 || (inPatient !== inFast && ev.fastTranscript !== null),
    lowConfidence: lowNeg.length > 0,
    reasons,
  };
}
