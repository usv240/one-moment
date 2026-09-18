// Forced-choice questions.
//
// Every voice agent confirms with "is that right?". In aphasia the default
// answer may be "yes", and clinicians use a dedicated Yes/No Questionnaire to
// establish whether a person's yes can be trusted at all. So One Moment asks a
// discriminative question whose answer carries information: "Amlodipine, or
// metformin?". This is also a published SCA technique: "pose fixed-choice
// questions" (Aphasia Institute).

import type { DissentResult, EvidenceBundle, ForcedChoice, LexiconTerm } from './types.ts';
import { chat, extractJson, type GatewayConfig } from './gateway.ts';
import { normalizeTokens } from './align.ts';
import { hasNegator, NEGATORS } from './negation.ts';

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
let seq = 0;
const nextId = () => `q${Date.now().toString(36)}${(seq++).toString(36)}`;

export type ChoiceProblem = string;

/**
 * Structural rules, from Hick's Law and the aphasia-friendly formatting
 * literature: two options, a short question, very short labels, and labels that
 * actually differ. "Something else" is always available and is not an option.
 */
export function validateChoice(q: Pick<ForcedChoice, 'prompt' | 'options'>): ChoiceProblem[] {
  const problems: ChoiceProblem[] = [];
  if (q.options.length !== 2) problems.push(`needs exactly 2 options, has ${q.options.length}`);
  if (wordCount(q.prompt) > 8) problems.push(`question is ${wordCount(q.prompt)} words, max 8`);
  for (const o of q.options) {
    if (!o.label.trim()) problems.push('empty option label');
    if (wordCount(o.label) > 4) problems.push(`"${o.label}" is ${wordCount(o.label)} words, max 4`);
    if (/^(yes|no)\b/i.test(o.label.trim())) problems.push(`"${o.label}" is a yes/no answer, which is unreliable in aphasia`);
  }
  const norm = q.options.map((o) => normalizeTokens(o.label).join(' '));
  if (new Set(norm).size !== norm.length) problems.push('options are identical');
  return problems;
}

function make(prompt: string, labels: [string, string], icon?: string, relays?: [string, string]): ForcedChoice {
  return {
    id: nextId(),
    prompt,
    options: labels.map((label, i) => ({
      id: i === 0 ? 'a' : 'b',
      label,
      ...(icon ? { icon } : {}),
      ...(relays ? { relay: relays[i] } : {}),
    })),
    allowSomethingElse: true,
  };
}

/** Swap one term for another inside a sentence, case-insensitively. */
const swapTerm = (sentence: string, from: string, to: string) =>
  sentence.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), to);

/**
 * A boosted lexicon term the unboosted stream did not confirm. The vocabulary
 * bias may have forced it, so offer it beside its most plausible sibling.
 */
export function lexiconChoice(ev: EvidenceBundle, lexicon: LexiconTerm[], advocateSay?: string): ForcedChoice | null {
  const hit = ev.lexiconHits.find((h) => !h.confirmedByFast);
  if (!hit) return null;
  const entry = lexicon.find((l) => l.term === hit.term);
  const sibling = lexicon.find((l) => l.term !== hit.term && l.category && l.category === entry?.category);
  if (!sibling) return null;
  const icon = entry?.category === 'medication' ? 'pill' : undefined;
  const base = advocateSay && advocateSay.toLowerCase().includes(hit.term.toLowerCase()) ? advocateSay : null;
  const relays: [string, string] = base
    ? [base, swapTerm(base, hit.term, sibling.term)]
    : [`It is about ${hit.term}.`, `It is about ${sibling.term}.`];
  return make(`${cap(hit.term)}, or ${sibling.term}?`, [cap(hit.term), cap(sibling.term)], icon, relays);
}

const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'it', 'my', 'is', 'am', 'are', 'be', 'do', 'does', 'did', 'for', 'on', 'in', 'at', 'with']);

/**
 * The two listening streams disagree about a "not" (rule 1). No model is
 * needed to ask about it, because the two readings are exactly what the two
 * ears heard: offer both. "Taking the metformin, or not taking the metformin?"
 * Each option relays the sentence one ear actually heard, confirmed by the
 * caller's own choice. Returns null if no short, valid question can be made.
 */
export function negationChoice(ev: EvidenceBundle, name = 'The caller'): ForcedChoice | null {
  if (ev.fastTranscript === null) return null;
  const pNeg = hasNegator(ev.patientTranscript);
  const fNeg = hasNegator(ev.fastTranscript);
  if (pNeg === fNeg) return null;
  const negative = pNeg ? ev.patientTranscript : ev.fastTranscript;
  const affirmative = pNeg ? ev.fastTranscript : ev.patientTranscript;
  const tokens = normalizeTokens(negative);
  const at = tokens.findIndex((t) => NEGATORS.has(t));
  const after = tokens.slice(at + 1, at + 4);
  // End the phrase on its last content word, so it never trails off on "the".
  let end = -1;
  after.forEach((t, i) => { if (!STOP.has(t) && t.length > 2) end = i; });
  if (end === -1) return null;
  const phrase = after.slice(0, end + 1).join(' ');
  const q = make('Which did you mean?', [cap(phrase), `Not ${phrase}`], undefined,
    [`${name} says: ${affirmative.trim()}`, `${name} says: ${negative.trim()}`]);
  return validateChoice(q).length === 0 ? q : null;
}

export const QUESTION_PROMPT = `Write one forced-choice question for a person with aphasia. Output ONE line of JSON. No prose. No markdown.
Schema: {"prompt":"string","a":"string","b":"string","sayA":"string","sayB":"string"}
prompt is at most 8 words. a and b are the two readings, at most 4 words each, and must differ in meaning. Never use yes or no as an option.
sayA and sayB are the full third-person sentences to tell the other party if the person picks a or b.
Example: {"prompt":"A new one, or stop it?","a":"A new one","b":"Stop it","sayA":"He would like a new prescription.","sayB":"He wants to stop taking it."}`;

/** Two readings disagree. Ask the person which one they meant. */
export async function readingsChoice(
  result: DissentResult,
  ev: EvidenceBundle,
  cfg: Omit<GatewayConfig, 'model'> & { model: string | null },
): Promise<ForcedChoice> {
  const a = result.advocate?.say ?? ev.patientTranscript;
  const b = result.skeptic?.reading || `Not: ${a}`;

  if (cfg.model) {
    const r = await chat(
      { ...cfg, model: cfg.model, maxRetries: 2 },
      QUESTION_PROMPT,
      `They said: ${ev.patientTranscript}\nReading 1: ${a}\nReading 2: ${b}`,
      80,
    );
    const j = r.ok ? extractJson<{ prompt?: string; a?: string; b?: string; sayA?: string; sayB?: string }>(r.content) : null;
    if (j?.prompt && j.a && j.b) {
      const q = make(j.prompt, [j.a, j.b], undefined, [j.sayA || a, j.sayB || b]);
      if (validateChoice(q).length === 0) return q;
    }
  }
  return fallbackChoice(ev, result.advocate?.say);
}

/**
 * No model, or the model's question failed validation. Never guess: offer the
 * most salient heard word against the person saying it differently.
 */
export function fallbackChoice(ev: EvidenceBundle, advocateSay?: string): ForcedChoice {
  const salient = ev.lexiconHits[0]?.term
    ?? normalizeTokens(ev.patientTranscript).filter((t) => t.length > 3).sort((x, y) => y.length - x.length)[0]
    ?? 'that';
  return make(`About ${salient}, or something new?`, [cap(salient), 'Something new'], undefined,
    [advocateSay ?? `It is about ${salient}.`, 'It is about something new.']);
}

export async function buildQuestion(args: {
  result: DissentResult;
  ev: EvidenceBundle;
  lexicon: LexiconTerm[];
  gateway: Omit<GatewayConfig, 'model'> & { model: string | null };
  callerName?: string;
}): Promise<ForcedChoice> {
  return (args.result.decision.policyRule === 1 ? negationChoice(args.ev, args.callerName) : null)
    ?? lexiconChoice(args.ev, args.lexicon, args.result.advocate?.say)
    ?? (await readingsChoice(args.result, args.ev, args.gateway));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
