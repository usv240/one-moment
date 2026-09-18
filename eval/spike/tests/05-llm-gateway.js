// TEST 05. Can the Advocate and the Skeptic argue inside 400 milliseconds?
//
// The Doherty threshold is 400ms. Conversation runs on a 208ms mean response
// offset. If the two-model debate takes a second, the product fails on exactly
// the axis it claims to fix, and the fallback ladder in the design has to become
// the main path.
//
// This runs a real Advocate and a real Skeptic against a real fragmentary
// utterance, in parallel, through the AssemblyAI LLM Gateway, and times it.
//
// It also checks the one thing that matters most: does the Skeptic catch a
// dropped negation? "not refill" becoming "refill" inverts the meaning, and
// disfluent speech drops function words first.

import { requireKey, save, header, verdict, kv, hr } from '../lib/report.js';
import { pickModel } from '../lib/dissent.js';

const apiKey = requireKey();

const BASE_URL = (process.env.LLM_GATEWAY_BASE_URL || 'https://llm-gateway.assemblyai.com/v1').replace(/\/$/, '');
const MODEL_CANDIDATES = process.env.LLM_GATEWAY_MODEL
  ? [process.env.LLM_GATEWAY_MODEL]
  : ['claude-sonnet-4-6', 'gemini-2.5-pro', 'gpt-5.2'];

const ROUNDS = 5;

// The evidence bundle the streaming layer would produce for Robert's utterance.
const EVIDENCE = {
  patientHypothesis: 'my the the white one heart not refill uh',
  fastHypothesis: 'my the the white one heart no refill uh',
  words: [
    { text: 'my', start: 400, end: 560, confidence: 0.81 },
    { text: 'the', start: 1200, end: 1310, confidence: 0.74 },
    { text: 'the', start: 3900, end: 4010, confidence: 0.69 },
    { text: 'white', start: 4100, end: 4400, confidence: 0.88 },
    { text: 'one', start: 4420, end: 4610, confidence: 0.86 },
    { text: 'heart', start: 7200, end: 7560, confidence: 0.79 },
    { text: 'not', start: 13800, end: 13920, confidence: 0.58 },
    { text: 'refill', start: 13940, end: 14380, confidence: 0.77 },
    { text: 'uh', start: 14600, end: 14780, confidence: 0.41 },
  ],
  largestGapMs: 6240,
  crossStreamDisagreement: [{ index: 6, patient: 'not', fast: 'no' }],
  lexicon: ['amlodipine', 'metformin', 'Walgreens', 'Dr Alvarez'],
  context: 'Robert has called his pharmacy. He has aphasia. Amlodipine is a white tablet he takes for blood pressure.',
};

const ADVOCATE_PROMPT = `You interpret fragmentary speech from a person with aphasia.
Propose the single most likely thing they are trying to communicate.

Return ONLY JSON:
{"interpretation": string,
 "spans": [{"text": string, "basis": "audio"|"profile"|"context"|"inference"}],
 "intent": string,
 "slots": object}

Every span must be tagged. Do not add commentary.`;

const SKEPTIC_PROMPT = `You are a sceptic. Your only job is to find spans of a proposed
interpretation that are NOT supported by the audio evidence, and to propose a rival
reading that fits the same evidence.

Check negation explicitly and on every turn. A dropped "not" inverts meaning entirely,
and disfluent speech drops function words first.

Return ONLY JSON:
{"challenges": [{"span": string, "type": "ungrounded"|"low_confidence"|"negation",
                 "argument": string, "severity": "blocking"|"requires_assent"}],
 "rivalInterpretation": string,
 "missingInformation": [string],
 "negationRisk": boolean}

Do not add commentary.`;

async function chat(model, system, user, { maxTokens = 400 } = {}) {
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  const ms = Date.now() - t0;
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, ms, body: text.slice(0, 300) };

  let json;
  try { json = JSON.parse(text); } catch { return { ok: false, status: res.status, ms, body: text.slice(0, 300) }; }
  return { ok: true, ms, content: json.choices?.[0]?.message?.content ?? '', usage: json.usage ?? null };
}

function extractJson(s) {
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

async function main() {
  header(
    'TEST 05  Can the Advocate and the Skeptic argue inside 400ms?',
    'Doherty threshold is 400ms. Conversation runs on a 208ms response offset.'
  );

  kv('gateway', BASE_URL);

  // Discover rather than guess. See lib/dissent.js pickModel.
  console.log('');
  console.log('Discovering which models this key is entitled to...');
  const picked = await pickModel({ apiKey, baseUrl: BASE_URL, candidates: MODEL_CANDIDATES });
  const model = picked.model;
  kv('models listed by gateway', picked.listed ?? 'unknown');
  kv('denied to this key', picked.denied?.length ?? 0);
  if (model) kv('using', `${model} (${picked.probeMs}ms probe)`);

  if (!model) {
    save('05-llm-gateway', { available: false, baseUrl: BASE_URL, tried: MODEL_CANDIDATES });
    console.log('');
    console.log('  No model reachable. Either this account has no LLM Gateway access,');
    console.log('  or the model identifiers have changed. Dissent can run on any');
    console.log('  OpenAI-compatible endpoint: set LLM_GATEWAY_BASE_URL and');
    console.log('  LLM_GATEWAY_MODEL in .env and rerun.');
    return verdict(false, 'LLM Gateway not reachable. Dissent latency unmeasured.');
  }

  const userMsg = `Evidence bundle:\n${JSON.stringify(EVIDENCE, null, 2)}`;

  console.log('');
  console.log(`Running ${ROUNDS} rounds. Advocate and Skeptic in PARALLEL, as the design specifies.`);
  console.log('');

  const rounds = [];
  for (let i = 0; i < ROUNDS; i++) {
    const t0 = Date.now();

    // Parallel, not sequential. A sequential debate would take over a second.
    // The Skeptic works mostly from the evidence bundle, so it does not need to
    // wait for a complete Advocate answer.
    const [adv, skep] = await Promise.all([
      chat(model, ADVOCATE_PROMPT, userMsg),
      chat(model, SKEPTIC_PROMPT,
        `${userMsg}\n\nProposed interpretation to attack: "Robert wants to refill his heart medication."`),
    ]);

    const totalMs = Date.now() - t0;
    const skepJson = extractJson(skep.content);
    const advJson = extractJson(adv.content);

    const caughtNegation = !!(
      skepJson?.negationRisk === true ||
      (skepJson?.challenges ?? []).some((c) =>
        c.type === 'negation' || /\bnot\b/i.test(c.argument ?? ''))
    );

    rounds.push({
      round: i + 1,
      advocateMs: adv.ms,
      skepticMs: skep.ms,
      totalMs,
      advocateValidJson: !!advJson,
      skepticValidJson: !!skepJson,
      caughtNegation,
      blockingChallenges: (skepJson?.challenges ?? []).filter((c) => c.severity === 'blocking').length,
      rivalInterpretation: skepJson?.rivalInterpretation ?? null,
    });

    console.log(
      `  round ${i + 1}: advocate ${String(adv.ms).padStart(4)}ms  ` +
      `skeptic ${String(skep.ms).padStart(4)}ms  ` +
      `total ${String(totalMs).padStart(4)}ms  ` +
      `negation ${caughtNegation ? 'CAUGHT' : 'missed'}`
    );
  }

  const totals = rounds.map((r) => r.totalMs).sort((a, b) => a - b);
  const p = (q) => totals[Math.min(totals.length - 1, Math.floor(q * totals.length))];
  const negationRate = rounds.filter((r) => r.caughtNegation).length / rounds.length;
  const jsonRate = rounds.filter((r) => r.advocateValidJson && r.skepticValidJson).length / rounds.length;

  const result = {
    available: true, baseUrl: BASE_URL, model, rounds,
    latency: { p50: p(0.5), p95: p(0.95), min: totals[0], max: totals[totals.length - 1] },
    negationCatchRate: negationRate,
    validJsonRate: jsonRate,
    withinDohertyBudget: p(0.95) < 400,
    sampleRival: rounds.find((r) => r.rivalInterpretation)?.rivalInterpretation ?? null,
  };
  save('05-llm-gateway', result);

  console.log('');
  hr();
  console.log('RESULTS');
  hr();
  kv('model', model);
  kv('total latency p50 / p95', `${result.latency.p50}ms / ${result.latency.p95}ms`);
  kv('within 400ms budget (p95)', result.withinDohertyBudget ? 'yes' : 'NO');
  kv('valid JSON both roles', `${(jsonRate * 100).toFixed(0)}%`);
  kv('negation caught', `${(negationRate * 100).toFixed(0)}%`);

  if (result.sampleRival) {
    console.log('');
    console.log('  the Skeptic\'s rival reading:');
    console.log(`    "${result.sampleRival}"`);
  }

  console.log('');
  if (!result.withinDohertyBudget) {
    console.log('  Over budget. The fallback ladder in _shared/02-DISSENT-ENGINE.md');
    console.log('  section 5 becomes the main path: drop the alternatives, then reduce');
    console.log('  the Skeptic to the negation and confidence checks only. Never');
    console.log('  bypass Dissent and speak.');
  }
  if (negationRate < 1) {
    console.log('  The Skeptic missed a negation in at least one round. Negation is the');
    console.log('  highest-consequence error class. Tighten the prompt, or add a');
    console.log('  deterministic negation check that does not depend on a model.');
  }

  const pass = jsonRate >= 0.8 && negationRate >= 0.8;
  return verdict(
    pass,
    pass
      ? `Dissent works. p95 ${result.latency.p95}ms, negation caught ${(negationRate * 100).toFixed(0)}% of the time.`
      : 'Dissent is unreliable at these settings. Tighten prompts before building on it.'
  );
}

main()
  .then((pass) => process.exit(pass ? 0 : 1))
  .catch((err) => { console.error(err); process.exit(1); });
