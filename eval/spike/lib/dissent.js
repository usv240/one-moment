// The Dissent engine, extracted so the benchmark and the product share one
// implementation. Advocate proposes, Skeptic attacks, Adjudicator decides.
//
// The Adjudicator is deterministic code, not a third model. The decision to
// speak on a disabled person's behalf is made by rules a person can read.

const DEFAULT_BASE = 'https://llm-gateway.assemblyai.com/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// MEASURED 17 Sept: the elaborate prompts in the first draft produced 0 percent
// valid JSON on qwen3.5-4b-32k-fast, the only model a free-tier key can reach.
// The model is capable; the prompt was the problem. A tight schema plus one
// worked example took it to 3/3 valid JSON and 3/3 correct negation detection.
//
// Rules that made the difference, worth keeping for any small model:
//   - one line of JSON, explicitly "no prose, no markdown, no code fence"
//   - a flat schema with short key names, not nested objects
//   - exactly one example of correct output
//   - define each field in one sentence, in the prompt, not by implication

export const ADVOCATE_PROMPT = `Output ONE line of JSON. No prose. No markdown. No code fence.
Schema: {"say":"string","polarity":"affirmative"|"negative","guessed":["word",...]}
say is the single sentence you would speak to the other party on this person's behalf.
polarity is negative if they are refusing, cancelling or negating something.
guessed lists any content word in "say" that is NOT present in the evidence words.
Example: {"say":"He does not want a refill.","polarity":"negative","guessed":[]}`;

export const SKEPTIC_PROMPT = `Output ONE line of JSON. No prose. No markdown. No code fence.
Schema: {"negationRisk":true|false,"blocked":["span",...],"rival":"string"}
negationRisk is true if the evidence words contain a negation ("not","no","never","stop","cancel","without") that the proposed sentence does not reflect.
blocked lists content words in the proposed sentence that are absent from the evidence words.
rival is the competing reading that fits the same evidence.
Example: {"negationRisk":true,"blocked":["medication"],"rival":"He does not want a refill."}`;

export async function chat({
  apiKey, baseUrl = DEFAULT_BASE, model, system, user,
  maxTokens = 400, maxRetries = 4,
}) {
  const t0 = Date.now();
  let rateLimited = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          model, temperature: 0, max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
    } catch (err) {
      return { ok: false, ms: Date.now() - t0, error: err.message, rateLimited };
    }

    const text = await res.text();

    if (res.status === 429) {
      rateLimited++;
      if (attempt === maxRetries) {
        return { ok: false, status: 429, ms: Date.now() - t0, rateLimited, body: text.slice(0, 200) };
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** attempt + Math.random() * 250);
      continue;
    }

    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, status: res.status, ms, rateLimited, body: text.slice(0, 300) };

    try {
      const json = JSON.parse(text);
      return { ok: true, ms, rateLimited, content: json.choices?.[0]?.message?.content ?? '' };
    } catch {
      return { ok: false, status: res.status, ms, rateLimited, body: text.slice(0, 300) };
    }
  }

  return { ok: false, ms: Date.now() - t0, rateLimited, error: 'retries exhausted' };
}

export function extractJson(s) {
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

/**
 * ARM: baseline. One model, given the degraded transcript, asked what the user
 * wants. No evidence bundle, no Skeptic, no gate.
 *
 * This is what a reasonable engineer builds, and what most of the other
 * submissions in this hackathon are. It is the column we have to beat.
 */
export async function runBaseline({ apiKey, baseUrl, model, degradedText }) {
  const r = await chat({
    apiKey, baseUrl, model,
    system: 'You are a voice assistant helping someone with a speech difficulty make a phone call. Interpret what they want and state it as a single clear sentence you would say to the other party. Return ONLY JSON: {"relay": string, "polarity": "affirmative"|"negative"}',
    user: `They said: "${degradedText}"`,
    maxTokens: 150,
  });

  const json = extractJson(r.content);
  return {
    arm: 'baseline',
    ms: r.ms,
    relayed: json?.relay ?? null,
    polarity: json?.polarity ?? null,
    refused: false,          // the baseline has no code path that refuses
    valid: !!json,
    error: r.ok ? null : (r.error ?? r.body ?? `status ${r.status}`),
  };
}

/**
 * ARM: full. Advocate and Skeptic in PARALLEL, then the deterministic
 * Adjudicator. Parallel is not an optimisation: a sequential debate exceeds the
 * 400ms budget and the product would fail on the axis it claims to fix.
 */
export async function runFull({ apiKey, baseUrl, model, degradedText, evidence, serial = false }) {
  const t0 = Date.now();
  const bundle = JSON.stringify({ ...evidence, transcript: degradedText }, null, 2);

  const advArgs = { apiKey, baseUrl, model, system: ADVOCATE_PROMPT,
    user: `Evidence bundle:
${bundle}` };
  const skepArgs = { apiKey, baseUrl, model, system: SKEPTIC_PROMPT,
    user: `Evidence bundle:
${bundle}

Attack the most likely interpretation of this utterance.` };

  // MEASURED: parallel is correct for LATENCY and wrong for THROUGHPUT on a
  // rate-limited tier. Firing both at once reliably triggers 429s, and the
  // backoff then costs far more than the round trip it saved.
  //
  //   serial = false  -> production. Minimise latency per turn.
  //   serial = true   -> benchmark. Hundreds of calls back to back, where a
  //                      429 storm is the binding constraint, not per-call speed.
  let advRes, skepRes;
  if (serial) {
    advRes = await chat(advArgs);
    skepRes = await chat(skepArgs);
  } else {
    [advRes, skepRes] = await Promise.all([chat(advArgs), chat(skepArgs)]);
  }

  const totalMs = Date.now() - t0;
  const advocate = extractJson(advRes.content);
  const skeptic = extractJson(skepRes.content);
  const decision = adjudicate({ advocate, skeptic, evidence });

  return {
    arm: 'full',
    ms: totalMs,
    advocateMs: advRes.ms,
    skepticMs: skepRes.ms,
    rateLimited: (advRes.rateLimited ?? 0) + (skepRes.rateLimited ?? 0),
    advocate,
    skeptic,
    ...decision,
    valid: !!advocate && !!skeptic,
    error: advRes.ok && skepRes.ok ? null : (advRes.body ?? skepRes.body ?? 'model error'),
  };
}

/**
 * The Adjudicator. Deterministic. Rules evaluated in order, first match wins.
 * Mirrors _shared/02-DISSENT-ENGINE.md section 3.
 *
 * The bias is deliberately asymmetric. One unnecessary question costs four
 * seconds. One invented sentence costs the user's autonomy.
 */
export function adjudicate({ advocate, skeptic, evidence = {} }) {
  // A malformed model response fails closed. It is treated as a blocking
  // challenge, never as permission to speak.
  if (!advocate || !skeptic) {
    return { refused: true, relayed: null, polarity: null, policyRule: 0, reason: 'schema_violation' };
  }

  const challenges = Array.isArray(skeptic.challenges) ? skeptic.challenges : [];

  if (challenges.some((c) => c.severity === 'blocking')) {
    return { refused: true, relayed: null, polarity: null, policyRule: 1, reason: 'blocking_challenge' };
  }
  if (skeptic.negationRisk === true) {
    return { refused: true, relayed: null, polarity: null, policyRule: 2, reason: 'negation_risk' };
  }

  const spans = Array.isArray(advocate.spans) ? advocate.spans : [];
  if (spans.some((s) => s.basis === 'inference')) {
    return { refused: true, relayed: null, polarity: null, policyRule: 3, reason: 'load_bearing_inference' };
  }
  if (challenges.some((c) => c.severity === 'requires_assent')) {
    return { refused: true, relayed: null, polarity: null, policyRule: 4, reason: 'requires_assent' };
  }

  const confs = (evidence.words ?? []).map((w) => w.confidence).filter((c) => typeof c === 'number');
  if (confs.length && Math.min(...confs) < 0.55) {
    return { refused: true, relayed: null, polarity: null, policyRule: 5, reason: 'low_confidence' };
  }
  // Rule 6 was: end_of_turn_confidence below 0.5 means keep holding the floor.
  // CORRECTION: on Universal-3.5 Pro that field is BINARY, 1.0 on end-of-turn and
  // 0.0 otherwise, so a 0.5 threshold carries no information. The graded signal
  // has to come from the gap profile instead: a long silence BETWEEN words is a
  // word-finding block, not a finished thought.
  // MEASURED: a mid-turn pause shows up as an abnormally long WORD, not a gap.
  // Either signal past 2500ms means the speaker was still working on the thought.
  const blockMs = Math.max(evidence.largestGapMs ?? 0, evidence.longestWordMs ?? 0);
  if (blockMs >= 2500 && evidence.endOfTurnConfidence !== 1) {
    return { refused: true, relayed: null, polarity: null, policyRule: 6, reason: 'turn_not_finished' };
  }

  return {
    refused: false,
    relayed: advocate.interpretation ?? null,
    polarity: advocate.polarity ?? null,
    policyRule: 7,
    reason: 'grounded',
  };
}

/**
 * Find a model this key can actually reach.
 *
 * MEASURED 17 Sept: the gateway lists ~37 models but a free-tier key is
 * entitled to exactly one of them. Every other id returns
 * 400 "Your account does not have access to this LLM Gateway model".
 * Hardcoding candidates from the docs therefore fails, and so does trusting
 * the docs' example ids.
 *
 * So: ask GET /models for the live catalogue, then probe for entitlement.
 * Preference order is smallest-and-fastest first, because Dissent runs on every
 * turn inside a 400ms budget.
 */
export async function pickModel({ apiKey, baseUrl = DEFAULT_BASE, candidates = [] }) {
  const base = baseUrl.replace(/\/$/, '');

  let listed = [];
  try {
    const res = await fetch(`${base}/models`, { headers: { authorization: apiKey } });
    if (res.ok) {
      const json = await res.json();
      listed = (json.data ?? []).map((m) => m.id);
    }
  } catch { /* fall through to candidates */ }

  // Explicit candidates first, then anything with a "fast"/"lite"/"mini"/"nano"
  // hint, then the rest of the catalogue.
  const hinted = listed.filter((id) => /fast|lite|mini|nano|flash|haiku/i.test(id));
  const order = [...new Set([...candidates, ...hinted, ...listed])];

  const denied = [];
  for (const model of order) {
    const r = await chat({ apiKey, baseUrl, model, system: 'Reply with: ok', user: 'ping', maxTokens: 8 });
    if (r.ok) return { model, probeMs: r.ms, listed: listed.length, denied };
    denied.push(model);
  }
  return { model: null, listed: listed.length, denied };
}
