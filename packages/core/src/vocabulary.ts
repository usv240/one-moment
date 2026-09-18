// Words from the caller's own list that the live evidence cannot vouch for.
//
// Two ways a medicine name goes wrong on a call, both measured on 18 Sept:
//
//  1. Unconfirmed. The patient ear is told the caller's vocabulary; the fast
//     ear is not. Four slurred ways of saying "amlodipine" all came back as
//     "amlodipine" from the boosted ear, and never from the unbiased one. A
//     boosted word nobody else heard may have been heard because it was expected.
//
//  2. Partial. In word-finding difficulty a person often gets part of the word
//     out: "am... am lo...". A short fragment that begins a word on their own
//     list is an attempt at that word. It is offered as a choice, never assumed.
//
// Either way the answer is the same published technique: offer the choice.
// "Amlodipine, or metformin?" The caller's tap is what grounds the word.

import { normalizeTokens } from './align.ts';
import type { EvidenceBundle, LexiconTerm } from './types.ts';

/** Categories where a wrong word matters and a sibling is a real alternative. */
export const CHOOSABLE = new Set<NonNullable<LexiconTerm['category']>>(['medication', 'pharmacy', 'doctor', 'family', 'place']);
const FILLERS = new Set(['um', 'uh', 'er', 'erm', 'ah', 'hmm', 'mm']);

export type VocabularyDoubt = {
  term: string;
  why: 'unconfirmed' | 'partial';
  /** The fragment the caller produced, for a partial attempt. */
  fragment: string | null;
  /** Which ear's transcript to build the relay sentence from. */
  source: 'patient' | 'fast';
};

const squash = (s: string) => normalizeTokens(s).join('');
const content = (text: string) => normalizeTokens(text).filter((t) => !FILLERS.has(t));

function partialAttempt(tokens: string[], term: string): string | null {
  const whole = squash(term);
  for (let i = 0; i < tokens.length; i++) {
    let joined = '';
    for (let j = i; j < Math.min(tokens.length, i + 3); j++) {
      if (tokens[j]!.length > 4) break;
      joined += tokens[j];
      if (joined.length >= 4 && joined !== whole && whole.startsWith(joined.slice(0, 4))) {
        // Repeated tries before it ("am, am lo") belong to the same attempt.
        let from = i;
        while (from > 0 && tokens[from - 1]!.length <= 4 && whole.startsWith(tokens[from - 1]!)) from--;
        return tokens.slice(from, j + 1).join(' ');
      }
    }
  }
  return null;
}

export function vocabularyDoubt(ev: EvidenceBundle, lexicon: LexiconTerm[]): VocabularyDoubt | null {
  const choosable = lexicon.filter((l) => l.category && CHOOSABLE.has(l.category));
  if (!choosable.length) return null;

  if (ev.fastTranscript !== null) {
    const hit = ev.lexiconHits.find((h) => !h.confirmedByFast && choosable.some((l) => l.term === h.term));
    if (hit) return { term: hit.term, why: 'unconfirmed', fragment: null, source: 'patient' };
  }

  const sources: ['patient' | 'fast', string][] = [['patient', ev.patientTranscript], ['fast', ev.fastTranscript ?? '']];
  for (const [source, text] of sources) {
    const tokens = content(text);
    const joined = ` ${tokens.join(' ')} `;
    for (const entry of choosable) {
      if (joined.includes(` ${normalizeTokens(entry.term).join(' ')} `)) continue;
      const fragment = partialAttempt(tokens, entry.term);
      if (fragment) return { term: entry.term, why: 'partial', fragment, source };
    }
  }
  return null;
}

/**
 * The caller's own sentence with the doubted word (or their attempt at it)
 * replaced by `word`, fillers removed. Null if the sentence cannot be rebuilt.
 */
export function sentenceWith(text: string, doubt: VocabularyDoubt, word: string): string | null {
  const tokens = content(text);
  const target = doubt.fragment ? doubt.fragment.split(' ') : normalizeTokens(doubt.term);
  for (let i = 0; i + target.length <= tokens.length; i++) {
    if (target.every((t, k) => tokens[i + k] === t)) {
      const out = [...tokens.slice(0, i), ...normalizeTokens(word), ...tokens.slice(i + target.length)];
      const s = out.join(' ').replace(/\bi\b/g, 'I');
      return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
    }
  }
  return null;
}
