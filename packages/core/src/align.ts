// Token alignment between the patient and fast hypotheses.
//
// Two streams on the same microphone with deliberately different configurations
// produce two transcripts. Where they differ is where the audio was genuinely
// ambiguous. That difference is the uncertainty signal the Skeptic works from,
// and it does not exist if you only listen once.

import type { Disagreement } from './types.ts';

export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(' ')
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

/**
 * Levenshtein alignment with backtrace. Returns only the positions that differ.
 * `index` is the position in the patient hypothesis the difference is anchored to.
 */
export function alignTokens(patient: string[], fast: string[]): Disagreement[] {
  const n = patient.length;
  const m = fast.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let i = 0; i <= n; i++) d[i]![0] = i;
  for (let j = 0; j <= m; j++) d[0]![j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = patient[i - 1] === fast[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,        // patient-only
        d[i]![j - 1]! + 1,        // fast-only
        d[i - 1]![j - 1]! + cost, // match or substitution
      );
    }
  }

  const out: Disagreement[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i]![j] === d[i - 1]![j - 1]! + (patient[i - 1] === fast[j - 1] ? 0 : 1)) {
      if (patient[i - 1] !== fast[j - 1]) {
        out.push({ index: i - 1, patient: patient[i - 1]!, fast: fast[j - 1]!, kind: 'substitution' });
      }
      i--; j--;
    } else if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) {
      out.push({ index: i - 1, patient: patient[i - 1]!, fast: null, kind: 'patient_only' });
      i--;
    } else {
      out.push({ index: i, patient: null, fast: fast[j - 1]!, kind: 'fast_only' });
      j--;
    }
  }
  return out.reverse();
}

/** Fraction of positions that disagree, 0..1. */
export function disagreementRate(patient: string[], fast: string[]): number {
  const len = Math.max(patient.length, fast.length);
  return len === 0 ? 0 : alignTokens(patient, fast).length / len;
}
