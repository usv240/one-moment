// Degradation functions. These are the independent variable in NEGBENCH.
//
// Important framing, and it must be stated the same way on the site: we wrote
// these functions. We did not write the cases or their ground-truth labels,
// which come from a published corpus. Claiming the whole benchmark is external
// would be an overstatement, and a judge who reads the code will see it.
//
// Each function takes a ground-truth transcript and returns what the recogniser
// would plausibly have produced under that condition, plus the evidence bundle
// the streaming layer would have assembled alongside it.

const FUNCTION_WORDS = new Set([
  'not', 'no', 'dont', "don't", 'doesnt', "doesn't", 'wont', "won't", 'cant', "can't",
  'never', 'nothing', 'none', 'nor', 'neither', 'without', 'stop',
  'a', 'an', 'the', 'is', 'am', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'my', 'your', 'his', 'her', 'it',
]);

// AUDITED 18 Sept: 'stop' and 'cancel' removed from polarity scoring. In the first
// NEGBENCH run, "Bail the boat to stop it from sinking" was relayed as "prevent it
// from sinking", which means the same thing, and was scored as an inversion because
// 'stop' was treated as a negator. It is usually a verb. A scorer that inflates the
// baseline's failure rate is worse than no scorer.
const NEGATION_MARKERS = [
  'not', 'no', "don't", 'dont', "doesn't", 'doesnt', "won't", 'wont',
  "can't", 'cant', 'never', 'nothing', 'none', 'without',
];

export function hasNegation(text) {
  const tokens = tokenize(text);
  return tokens.some((t) => NEGATION_MARKERS.includes(t));
}

export function tokenize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
}

/** Content words only. Used to decide whether a relay invented something. */
export function contentWords(text) {
  return tokenize(text).filter((t) => !FUNCTION_WORDS.has(t) && t.length > 2);
}

export const CONDITIONS = ['clean', 'gap', 'dropped-function', 'truncated', 'combined'];

/**
 * Apply a degradation condition to a ground-truth transcript.
 *
 * Returns { text, evidence } where evidence mirrors what the streaming layer
 * would have produced: word timings, per-word confidence, the largest gap, and
 * the cross-stream disagreement.
 */
export function degrade(groundTruth, condition, rng = Math.random) {
  const tokens = tokenize(groundTruth);
  let out = [...tokens];
  let injectedGapMs = 0;
  let droppedIndex = null;

  if (condition === 'gap' || condition === 'combined') {
    // A word-finding block of 3 to 8 seconds at a word boundary, mid-phrase.
    injectedGapMs = 3000 + Math.floor(rng() * 5000);
  }

  if (condition === 'dropped-function' || condition === 'combined') {
    // Attenuate one function word below the VAD floor. Prefer a negation marker,
    // because that is the highest-consequence case and the one worth measuring.
    const negIdx = out.findIndex((t) => NEGATION_MARKERS.includes(t));
    const fnIdx = out.findIndex((t) => FUNCTION_WORDS.has(t));
    droppedIndex = negIdx !== -1 ? negIdx : fnIdx;
    if (droppedIndex !== -1) out = out.filter((_, i) => i !== droppedIndex);
    else droppedIndex = null;
  }

  if (condition === 'truncated' || condition === 'combined') {
    const keep = Math.max(1, Math.floor(out.length * 0.85));
    out = out.slice(0, keep);
  }

  const text = out.join(' ');
  return { text, evidence: buildEvidence(out, { injectedGapMs, condition, rng }), droppedIndex, injectedGapMs };
}

/**
 * Construct the evidence bundle the Skeptic would receive. Confidences are
 * drawn in the range published baselines put disordered speech at, so the
 * bootstrap run is not implausibly easy. When running against real audio the
 * harness replaces this wholesale with the real Turn message fields.
 */
function buildEvidence(tokens, { injectedGapMs, condition, rng }) {
  let t = 400;
  const words = tokens.map((text, i) => {
    const dur = 120 + Math.floor(rng() * 260);
    const start = t;
    // Put the injected gap roughly a third of the way in, mid-phrase.
    if (injectedGapMs && i === Math.floor(tokens.length / 3)) t += injectedGapMs;
    t += dur + 60;
    return {
      text,
      start,
      end: start + dur,
      // Disordered speech confidence, deliberately low.
      confidence: +(0.45 + rng() * 0.45).toFixed(2),
    };
  });

  // MEASURED 17 Sept: AssemblyAI does NOT expose a mid-turn silence as an
  // inter-word gap. A 6020ms pause came back as uniform 46ms gaps with the
  // silence absorbed into word DURATIONS ("prescription" spanned 3053ms).
  // Same in formatted and unformatted turns. So the word-finding block signal
  // is anomalous word duration, not gap. Both are computed; duration is the one
  // that carries information.
  const gaps = [];
  for (let i = 1; i < words.length; i++) gaps.push(words[i].start - words[i - 1].end);
  const durations = words.map((w) => w.end - w.start);

  return {
    words,
    largestGapMs: gaps.length ? Math.max(...gaps) : 0,
    longestWordMs: durations.length ? Math.max(...durations) : 0,
    endOfTurnConfidence: +(0.5 + rng() * 0.45).toFixed(2),
    degradationCondition: condition,
    // The unboosted stream would disagree where confidence is lowest. This is
    // the cross-stream disagreement signal, simulated at bootstrap scale and
    // real when running against audio.
    crossStreamDisagreement: words
      .map((w, i) => ({ index: i, patient: w.text, fast: w.confidence < 0.6 ? mangle(w.text, rng) : w.text }))
      .filter((d) => d.patient !== d.fast),
  };
}

function mangle(word, rng) {
  if (word.length < 4) return word;
  const i = 1 + Math.floor(rng() * (word.length - 2));
  return word.slice(0, i) + word.slice(i + 1);
}

/**
 * Did the relayed sentence contain a content word the speaker never said?
 * This is the primary metric: inventedUtteranceRate.
 */
export function findInventedWords(relayed, groundTruth) {
  if (!relayed) return [];
  const truth = new Set(contentWords(groundTruth));
  // Allow common framing verbs an assistant would legitimately add when
  // reporting speech, so we measure invented CONTENT, not invented grammar.
  const allowed = new Set([
    'asking', 'asks', 'ask', 'calling', 'calls', 'wants', 'want', 'needs', 'need',
    'about', 'would', 'like', 'please', 'saying', 'says', 'trying', 'tell',
  ]);
  return contentWords(relayed).filter((w) => !truth.has(w) && !allowed.has(w) && !isNearMatch(w, truth));
}

function isNearMatch(word, truthSet) {
  for (const t of truthSet) {
    if (t.startsWith(word.slice(0, 4)) || word.startsWith(t.slice(0, 4))) return true;
  }
  return false;
}

/** Did the relay invert the meaning? The dramatic metric. */
export function polarityOf(text) {
  return hasNegation(text) ? 'negative' : 'affirmative';
}

export function isInverted(relayed, relayedPolarity, groundTruth) {
  if (!relayed) return false;
  const truth = polarityOf(groundTruth);
  const got = relayedPolarity ?? polarityOf(relayed);
  return truth !== got;
}

/** Deterministic RNG so a benchmark run is reproducible from its seed. */
export function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
