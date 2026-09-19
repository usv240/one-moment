// Scoring shared by every benchmark, so all of them mean the same thing by
// "invented", "flipped" and "word error". Both arms of every comparison are
// scored by these functions, never by the engine's own checks.

import { contentWords, FRAMING, NEGATORS, normalizeTokens, polarityOf } from '@one-moment/core';

/** Reporting framing, pronouns and determiners are not claims about what was said. */
const NOT_CONTENT = new Set([...contentWords('The caller'), 'any', 'some', 'all', 'every', 'each', 'very',
  // Pronoun contractions are function words, not content ("he definitely, he's definitely").
  "he's", "she's", "it's", "i'm", "you're", "we're", "they're", "that's", "there's", "what's", "let's",
  "i've", "you've", "we've", "they've", "i'd", "you'd", "he'd", "she'd", "we'd", "they'd",
  "i'll", "you'll", "he'll", "she'll", "we'll", "they'll", "it'll"]);

/** "hung" and "hanging" are the same word said differently, not an invented one. */
const IRREGULAR = {
  gave: 'give', given: 'give', hung: 'hang', made: 'make', sat: 'sit', said: 'say', took: 'take', ran: 'run', went: 'go',
  gone: 'go', bought: 'buy', brought: 'bring', thought: 'think', told: 'tell', found: 'find', kept: 'keep', left: 'leave',
  felt: 'feel', held: 'hold', broke: 'break', broken: 'break', spent: 'spend', meant: 'mean', built: 'build', bound: 'bind',
  got: 'get', seemed: 'seem', were: 'be', was: 'be', ate: 'eat', drank: 'drink', wrote: 'write', written: 'write', saw: 'see',
  seen: 'see', came: 'come', knew: 'know', known: 'know', grew: 'grow', drove: 'drive', rode: 'ride', spoke: 'speak',
};
export const lemma = (w) => {
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length > 4 && /(ied|ies)$/.test(w)) return `${w.slice(0, -3)}y`;
  for (const suf of ['ing', 'ed', 'es', 's']) if (w.length > suf.length + 2 && w.endsWith(suf)) return w.slice(0, -suf.length);
  return w;
};

/** "3 sweaters" and "three sweaters" are the same words: spell small numbers out before comparing. */
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const TENS = { 30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty', 70: 'seventy', 80: 'eighty', 90: 'ninety', 100: 'hundred' };
export const spelled = (text) => String(text ?? '').replace(/(?<![\d.])(\d{1,3})(?![\d.])/g, (m) => NUM[Number(m)] ?? TENS[Number(m)] ?? m);

/** Content words in `relayed` that are not in what the person said. */
export function findInventedWords(relayed, groundTruth) {
  if (!relayed) return [];
  relayed = spelled(relayed);
  groundTruth = spelled(groundTruth);
  const truth = new Set(contentWords(groundTruth).map(lemma));
  const near = (w) => [...truth].some((t) => t.slice(0, 4) === w.slice(0, 4) && Math.min(t.length, w.length) >= 4);
  return contentWords(relayed).filter((w) => {
    const l = lemma(w);
    return !truth.has(l) && !FRAMING.has(w) && !NOT_CONTENT.has(w) && !NEGATORS.has(w) && !near(l);
  });
}

/** Meaning flipped: relay and truth differ in polarity, by the full negator list. */
export const isInverted = (relayed, groundTruth) => (relayed ? polarityOf(relayed) !== polarityOf(groundTruth) : false);

/** Word error rate: word-level edit distance over the reference length. */
export function wer(hypothesis, reference) {
  const h = normalizeTokens(spelled(hypothesis));
  const r = normalizeTokens(spelled(reference));
  if (!r.length) return h.length ? 1 : 0;
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[h.length] / r.length;
}

/** A relay is materially wrong if it puts a word in the speaker's mouth or flips the meaning. */
export const materiallyWrong = (relayed, groundTruth) =>
  Boolean(relayed) && (findInventedWords(relayed, groundTruth).length > 0 || isInverted(relayed, groundTruth));

/** Strip the framing we add, so a relay is compared on what it claims was said. */
export const claim = (relayed) => (relayed ? relayed.replace(/^[^:]{1,40}\bsays:\s*/i, '') : relayed);
