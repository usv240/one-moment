// Dissent: an adversarial grounding verifier.
//
// Advocate proposes what the person meant. Skeptic gives its own independent,
// cautious reading of the same evidence. Deterministic checks run beside both.
// The Adjudicator, which is code and not a model, decides whether to speak on
// the person's behalf, ask them, or keep holding the floor.
//
// The bias is deliberately asymmetric. One unnecessary question costs a few
// seconds. One invented sentence spoken in a disabled person's name costs the
// autonomy the product exists to restore.

import type {
  AdvocateOutput, Decision, DeterministicFindings, DissentResult, EvidenceBundle, LexiconTerm, SkepticOutput,
} from './types.ts';
import { chat, discoverModel, extractJson, type GatewayConfig } from './gateway.ts';
import { assessNegation, hasNegator, polarityOf } from './negation.ts';
import { normalizeTokens } from './align.ts';
import { vocabularyDoubt } from './vocabulary.ts';

// Prompts are written for a small model. Measured: the first, elaborate drafts
// produced 0 percent valid JSON on the only model a free key can reach. A flat
// one-line schema with one worked example took it to 3 of 3.

export const ADVOCATE_PROMPT = `You speak on behalf of a person with aphasia on a phone call. Output ONE line of JSON. No prose. No markdown. No code fence.
Schema: {"say":"string","polarity":"affirmative"|"negative","guessed":["word"]}
say is one short sentence, in the third person, reporting what the person said. Keep their own words. Do not add wants, needs or requests they did not say. Use only what the evidence supports.
polarity is negative if the person is refusing, cancelling or negating something.
guessed lists every content word in say that is NOT in the evidence words.
Example: {"say":"He is asking about his amlodipine.","polarity":"affirmative","guessed":[]}`;

export const SKEPTIC_PROMPT = `You are a sceptic checking what a person with aphasia said on a phone call. Output ONE line of JSON. No prose. No markdown. No code fence.
Schema: {"negationRisk":true|false,"unsupported":["word"],"polarity":"affirmative"|"negative","reading":"string"}
negationRisk is true if a negation could have been lost or is uncertain: low confidence words, streams that disagree, or a sentence that is cut off.
unsupported lists content words the most natural reading would need that are NOT in the evidence words.
reading is your own most cautious one-sentence reading. polarity is its polarity.
Example: {"negationRisk":true,"unsupported":["medication"],"polarity":"negative","reading":"He may not want a refill."}`;

/** Plain-language names for each rule, shown in the Observer View's Adjudicator column. */
export const POLICY_RULES: Record<number, { name: string; plain: string }> = {
  0: { name: 'schema_violation', plain: 'A model reply could not be read, so nothing is spoken.' },
  1: { name: 'negation_disputed', plain: 'The two listening streams disagree about a "not", so the meaning itself is uncertain.' },
  2: { name: 'invented_words', plain: 'The proposed sentence contains words the person never said.' },
  3: { name: 'polarity_mismatch', plain: 'The proposed sentence flips yes and no compared with what was heard.' },
  4: { name: 'readings_disagree', plain: 'The Advocate and the Skeptic read the sentence in opposite directions.' },
  5: { name: 'skeptic_negation_risk', plain: 'The Skeptic thinks a "not" may have been lost.' },
  6: { name: 'low_confidence', plain: 'Part of what was heard is too uncertain to repeat.' },
  7: { name: 'still_speaking', plain: 'The person has not finished. Keep waiting.' },
  8: { name: 'grounded', plain: 'Every word traces back to something the person said. Safe to speak.' },
  9: { name: 'verbatim', plain: 'The person said a complete sentence clearly. Their own words are relayed, with nothing added.' },
  10: { name: 'model_unavailable', plain: 'The checking models are busy or unreachable, so the system asks rather than guessing.' },
  11: { name: 'vocabulary_uncertain', plain: 'A word from the caller\'s own list was only partly said, or heard only by the ear that was listening for it. It is offered as a choice, never assumed. Checked second, before any model.' },
};

/**
 * VERBATIM-FIRST. Added 18 Sept after measuring the free-tier LLM Gateway at
 * 2 requests per minute.
 *
 * When the caller produces a complete, clear sentence and every deterministic
 * check passes, the most grounded possible relay is their own words, quoted.
 * No model is involved, so no model can add a word. Models are only needed when
 * speech is genuinely fragmentary. This is also the SCA technique as published:
 * repeat the person's message when it is complete; expand it only when it is not.
 */
export function verbatimEligible(ev: EvidenceBundle, minConfidence = 0.8): boolean {
  const text = ev.patientTranscript.trim();
  const complete = /[.!?]$/.test(text);
  const enough = contentWords(text).length >= 3;
  const confident = ev.minConfidence === null || ev.minConfidence >= minConfidence;
  const agreed = ev.disagreement.length === 0 || ev.fastTranscript === null;
  const lexiconOk = ev.lexiconHits.every((h) => h.confirmedByFast || ev.fastTranscript === null);
  return ev.endOfTurn && complete && enough && confident && agreed && lexiconOk;
}

export function verbatimRelay(ev: EvidenceBundle, name: string): string {
  return `${name} says: ${ev.patientTranscript.trim()}`;
}

const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'in', 'on',
  'at', 'for', 'with', 'by', 'from', 'and', 'or', 'but', 'so', 'if', 'then', 'that', 'this', 'it',
  'its', 'my', 'your', 'his', 'her', 'their', 'our', 'he', 'she', 'they', 'we', 'you', 'i', 'me',
  'him', 'them', 'us', 'do', 'does', 'did', 'has', 'have', 'had', 'will', 'would', 'can', 'could',
  'should', 'may', 'might', 'please', 'uh', 'um', 'er',
]);

/** Framing an assistant legitimately adds when reporting speech. Not invented content. */
export const FRAMING = new Set([
  'asking', 'asks', 'ask', 'calling', 'calls', 'call', 'wants', 'want', 'needs', 'need', 'about',
  'like', 'saying', 'says', 'said', 'trying', 'tell', 'telling', 'would', 'regarding', 'person',
]);

export const contentWords = (text: string): string[] =>
  normalizeTokens(text).filter((t) => !FUNCTION_WORDS.has(t) && t.length > 2);

/** Content words in `proposed` that the evidence does not support. */
export function inventedWords(proposed: string, ev: EvidenceBundle, allowed: string[] = []): string[] {
  const heard = new Set([
    ...contentWords(ev.patientTranscript),
    ...(ev.fastTranscript ? contentWords(ev.fastTranscript) : []),
    ...allowed.flatMap(contentWords),
  ]);
  const near = (w: string) => [...heard].some((h) => h.slice(0, 5) === w.slice(0, 5) && Math.min(h.length, w.length) >= 4);
  return contentWords(proposed).filter((w) => !heard.has(w) && !FRAMING.has(w) && !hasNegator(w) && !near(w));
}

export function deterministicFindings(
  ev: EvidenceBundle,
  advocate: AdvocateOutput | null,
  allowed: string[] = [],
): DeterministicFindings {
  const neg = assessNegation(ev);
  const invented = advocate ? inventedWords(advocate.say, ev, allowed) : [];
  const heardPolarity = polarityOf(ev.patientTranscript);
  const saidPolarity = advocate ? polarityOf(advocate.say) : heardPolarity;
  return {
    negationInEvidence: neg.present,
    negationDisputed: neg.disputed || neg.lowConfidence,
    invented,
    polarityMismatch: advocate !== null && heardPolarity !== saidPolarity,
  };
}

/**
 * The Adjudicator. Deterministic. Evaluated in order, first match wins.
 * Rules 1 to 3 need no model at all, so no model can talk its way past them.
 */
export function adjudicate(args: {
  ev: EvidenceBundle;
  advocate: AdvocateOutput | null;
  skeptic: SkepticOutput | null;
  det: DeterministicFindings;
  confidenceFloor?: number;
}): Decision {
  const { ev, advocate, skeptic, det } = args;
  const floor = args.confidenceFloor ?? 0.55;

  if (!ev.endOfTurn) return { action: 'hold', policyRule: 7, reason: 'still_speaking' };
  if (!advocate || !advocate.say) return { action: 'ask', policyRule: 0, reason: 'schema_violation' };
  if (det.negationDisputed) return { action: 'ask', policyRule: 1, reason: 'negation_disputed', target: 'polarity' };
  if (det.invented.length) return { action: 'ask', policyRule: 2, reason: 'invented_words', target: det.invented[0] };
  if (det.polarityMismatch) return { action: 'ask', policyRule: 3, reason: 'polarity_mismatch', target: 'polarity' };
  if (skeptic && skeptic.polarity !== advocate.polarity) {
    return { action: 'ask', policyRule: 4, reason: 'readings_disagree', target: 'polarity' };
  }
  if (skeptic?.negationRisk) return { action: 'ask', policyRule: 5, reason: 'skeptic_negation_risk', target: 'polarity' };
  const weak = ev.lowConfidenceWords.find((w) => w.confidence < floor);
  if (weak) return { action: 'ask', policyRule: 6, reason: 'low_confidence', target: weak.text };
  return { action: 'relay', text: advocate.say, policyRule: 8, reason: 'grounded' };
}

/** Compact, small-model-friendly rendering of the evidence. */
export function renderEvidence(ev: EvidenceBundle, context?: string): string {
  const words = ev.words.map((w) => `${w.text}(${w.confidence.toFixed(2)})`).join(' ');
  const lines = [
    `Evidence words: ${words || ev.patientTranscript}`,
    ev.fastTranscript !== null ? `Second listener heard: ${ev.fastTranscript}` : '',
    ev.disagreement.length
      ? `Listeners disagree: ${ev.disagreement.map((d) => `${d.patient ?? '-'} vs ${d.fast ?? '-'}`).join('; ')}`
      : '',
    ev.blockWords.length ? `Long pauses inside: ${ev.blockWords.map((b) => b.text).join(', ')}` : '',
    context ? `Context: ${context}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

export type DissentOptions = GatewayConfig & {
  /** Profile and call context: who is calling, whom, about what. */
  context?: string;
  /** Words the Advocate may use without them counting as invented, e.g. the caller's name. */
  allowedWords?: string[];
  /** The caller's name, used when relaying their own words verbatim. */
  callerName?: string;
  /** Parallel minimises latency. Serial survives rate limits during benchmarks. */
  mode?: 'parallel' | 'serial';
  /**
   * Live calls cannot wait out a 50 second Retry-After. When true, a rate limit
   * fails fast and the turn degrades to a question. Benchmarks set it false.
   */
  live?: boolean;
  /** Skip the verbatim path, forcing the model path. Benchmarks use this to measure the models. */
  modelsOnly?: boolean;
  /** No model may be called (no key supplied). Turns that need one are asked, never guessed. */
  noModels?: boolean;
  /** The caller's own vocabulary, for rule 11. */
  lexicon?: LexiconTerm[];
};

export async function runDissent(ev: EvidenceBundle, opts: DissentOptions): Promise<DissentResult> {
  const t0 = Date.now();
  const done = (decision: DissentResult['decision'], extra: Partial<DissentResult> = {}): DissentResult => ({
    advocate: null, skeptic: null,
    deterministic: deterministicFindings(ev, null, opts.allowedWords),
    decision,
    timings: { advocateMs: null, skepticMs: null, totalMs: Date.now() - t0 },
    model: null,
    ...extra,
  });

  // Still speaking: never decide, never spend a model call. Keep holding.
  if (!ev.endOfTurn) return done({ action: 'hold', policyRule: 7, reason: 'still_speaking' });

  // Deterministic checks first. Rules that need no model cannot be argued past.
  const pre = deterministicFindings(ev, null, opts.allowedWords);
  if (pre.negationDisputed) return done({ action: 'ask', policyRule: 1, reason: 'negation_disputed', target: 'polarity' });

  // Rule 11. The patient ear is told the caller's vocabulary; the fast ear is
  // not. MEASURED 18 Sept: four slurred ways of saying "amlodipine" all came
  // back as "amlodipine" from the boosted ear, and never from the unbiased one.
  // A boosted word nobody else heard may have been heard because it was
  // expected. For a medicine, that is exactly the word not to guess.
  // And a caller mid-way through finding a word often gets part of it out
  // ("am, am lo"). That is an attempt at a word on their list, not the word.
  const doubt = vocabularyDoubt(ev, opts.lexicon ?? []);
  if (doubt) return done({ action: 'ask', policyRule: 11, reason: `vocabulary_${doubt.why}`, target: doubt.term });

  // A complete, clear sentence: relay the person's own words. Zero model calls.
  if (!opts.modelsOnly && verbatimEligible(ev)) {
    return done({ action: 'relay', text: verbatimRelay(ev, opts.callerName ?? 'The caller'), policyRule: 9, reason: 'verbatim' });
  }

  if (opts.noModels || !opts.apiKey) return done({ action: 'ask', policyRule: 10, reason: 'model_unavailable' });
  const model = await discoverModel(opts);
  if (!model) return done({ action: 'ask', policyRule: 10, reason: 'model_unavailable' });

  const cfg = { ...opts, model, maxRetries: opts.live === false ? (opts.maxRetries ?? 4) : 0 };
  const evidenceText = renderEvidence(ev, opts.context);
  const advCall = () => chat(cfg, ADVOCATE_PROMPT, evidenceText);
  const skepCall = () => chat(cfg, SKEPTIC_PROMPT, evidenceText);

  const [advRes, skepRes] = opts.mode === 'serial'
    ? [await advCall(), await skepCall()]
    : await Promise.all([advCall(), skepCall()]);

  const advocate = normaliseAdvocate(advRes.ok ? extractJson(advRes.content) : null);
  const skeptic = normaliseSkeptic(skepRes.ok ? extractJson(skepRes.content) : null);
  const det = deterministicFindings(ev, advocate, opts.allowedWords);

  // The Advocate is required to speak. If it was rate limited, ask instead of guessing.
  const limited = (!advRes.ok && advRes.status === 429) || (!skepRes.ok && skepRes.status === 429);
  const decision = !advocate && limited
    ? { action: 'ask' as const, policyRule: 10, reason: 'model_unavailable' }
    : adjudicate({ ev, advocate, skeptic, det });

  return {
    advocate, skeptic, deterministic: det, decision,
    timings: { advocateMs: advRes.ms, skepticMs: skepRes.ms, totalMs: Date.now() - t0 },
    model,
  };
}

function normaliseAdvocate(j: unknown): AdvocateOutput | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  if (typeof o.say !== 'string' || !o.say.trim()) return null;
  return {
    say: o.say.trim(),
    polarity: o.polarity === 'negative' ? 'negative' : 'affirmative',
    guessed: Array.isArray(o.guessed) ? o.guessed.filter((x): x is string => typeof x === 'string') : [],
  };
}

function normaliseSkeptic(j: unknown): SkepticOutput | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  return {
    negationRisk: o.negationRisk === true,
    unsupported: Array.isArray(o.unsupported) ? o.unsupported.filter((x): x is string => typeof x === 'string') : [],
    polarity: o.polarity === 'negative' ? 'negative' : 'affirmative',
    reading: typeof o.reading === 'string' ? o.reading : '',
  };
}
