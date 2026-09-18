// The public API: the patient-mode decision layer, as a service.
//
//   POST /v1/decide
//   Authorization: Bearer <your AssemblyAI key>   (optional)
//
// Hand it what your own AssemblyAI stream heard, ideally the raw Turn message,
// and it returns what One Moment would do: relay (and exactly what to say), ask
// (and the two-choice question to ask), or keep waiting. With no key it still
// answers every turn that needs no model, and asks on the rest. It never guesses.
//
// Stateless. Nothing sent to it is stored. The key, if given, is used for this
// request's LLM Gateway calls and then dropped.

import {
  assembleEvidence, buildQuestion, POLICY_RULES, runDissent,
  type DissentResult, type ForcedChoice, type LexiconTerm, type StreamTurn, type Word,
} from '@one-moment/core';

export type DecideRequest = {
  /** The Turn message from your patient-mode AssemblyAI stream, as received. */
  turn?: StreamTurn;
  /** Optional second, differently configured stream on the same audio. */
  fastTurn?: StreamTurn;
  /** Or plain text, if you have no Turn message. Confidence is then treated as unknown. */
  transcript?: string;
  fastTranscript?: string;
  /** How to refer to the caller when relaying: "Robert says: ...". */
  name?: string;
  /** The caller's own vocabulary: words, or { term, category } so rule 11 can offer siblings. */
  lexicon?: (string | { term: string; category?: LexiconTerm['category'] })[];
  /** A sentence of context for the models. */
  context?: string;
  /** An LLM Gateway model id. */
  model?: string;
};

export type DecideResponse = {
  action: 'relay' | 'ask' | 'hold';
  /** Exactly what to say to the other party, when action is relay. */
  say: string | null;
  /** The two-choice question for the caller, when action is ask. */
  question: ForcedChoice | null;
  rule: { number: number; name: string; plain: string };
  checks: DissentResult['deterministic'];
  readings: { advocate: string | null; skeptic: string | null };
  heard: { patient: string; fast: string | null; disagreements: number; minConfidence: number | null; hiddenPauses: { word: string; ms: number }[] };
  models: { used: string | null; calls: number };
  ms: number;
};

/**
 * Words for plain text. Confidence is unknown, so the confidence rules do not
 * fire on it. `spanMs` spreads the words over a given duration, so a second
 * transcript lines up with the first however many words each has.
 */
function textTurn(text: string, spanMs?: number): StreamTurn {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const step = spanMs ? spanMs / Math.max(1, parts.length) : 360;
  const words: Word[] = parts.map((w, i) => ({ text: w, start: Math.round(i * step), end: Math.round(i * step + step * 0.8), confidence: 1 }));
  return { type: 'Turn', turn_order: 0, end_of_turn: true, transcript: text.trim(), words };
}

export class BadRequest extends Error {}

export async function decide(body: DecideRequest, apiKey: string | null): Promise<DecideResponse> {
  const t0 = Date.now();
  const patient = body.turn ?? (typeof body.transcript === 'string' && body.transcript.trim() ? textTurn(body.transcript) : null);
  if (!patient || typeof patient.transcript !== 'string' || !Array.isArray(patient.words)) {
    throw new BadRequest('Send "turn" (an AssemblyAI Turn message) or "transcript" (text).');
  }
  if (patient.transcript.length > 2000) throw new BadRequest('transcript is longer than 2000 characters');
  const span = patient.words.length ? patient.words[patient.words.length - 1]!.end : undefined;
  const fast = body.fastTurn ?? (body.fastTranscript ? textTurn(body.fastTranscript, span) : null);
  const lexicon: LexiconTerm[] = (body.lexicon ?? []).slice(0, 100).flatMap((x): LexiconTerm[] =>
    typeof x === 'string' ? [{ term: x }] : x && typeof x.term === 'string' ? [{ term: x.term, ...(x.category ? { category: x.category } : {}) }] : []);
  const ev = assembleEvidence({ patient, ...(fast ? { fastFinals: [fast] } : {}), lexicon });
  const name = (body.name ?? 'The caller').slice(0, 40);

  const result = await runDissent(ev, {
    apiKey: apiKey ?? '',
    ...(body.model ? { model: body.model } : {}),
    ...(body.context ? { context: body.context.slice(0, 500) } : {}),
    allowedWords: [name],
    callerName: name,
    lexicon,
    mode: 'parallel',
    live: true,
    noModels: !apiKey,
  });
  const d = result.decision;
  const question = d.action === 'ask'
    ? await buildQuestion({ result, ev, lexicon, gateway: { apiKey: apiKey ?? '', model: apiKey ? result.model : null }, callerName: name })
    : null;
  const rule = POLICY_RULES[d.policyRule] ?? { name: 'unknown', plain: '' };

  return {
    action: d.action,
    say: d.action === 'relay' ? d.text : null,
    question,
    rule: { number: d.policyRule, name: rule.name, plain: rule.plain },
    checks: result.deterministic,
    readings: { advocate: result.advocate?.say ?? null, skeptic: result.skeptic?.reading ?? null },
    heard: {
      patient: ev.patientTranscript,
      fast: ev.fastTranscript,
      disagreements: ev.disagreement.length,
      minConfidence: ev.minConfidence,
      hiddenPauses: ev.blockWords.map((b) => ({ word: b.text, ms: b.ms })),
    },
    models: { used: result.model, calls: (result.timings.advocateMs !== null ? 1 : 0) + (result.timings.skepticMs !== null ? 1 : 0) },
    ms: Date.now() - t0,
  };
}
