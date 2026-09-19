// NEGBENCH, run against the product's own engine.
//
// The question: does the system speak words the person never said, and does it
// flip a "not"? And the cost: how often does it refuse when a plain reading
// would have been fine?
//
// Two arms, the same model, the same degraded input:
//   baseline  one model asked to say what the person meant. No checks.
//   full      packages/core runDissent: deterministic checks, Advocate, Skeptic,
//             and the Adjudicator. Exactly what a live call runs.
//
// Cases: Harvard Sentences (IEEE Std 297-1969, public domain). We did not write
// them. We did write the degradation (eval/spike/lib/degrade.js), and the site
// says so. Text level: this measures the decision layer, not recognition.
//
// Conditions:
//   clean       the sentence as spoken, clear-speech confidences (0.90 to 0.99).
//   one-ear     one listening stream loses a word (the "not" when there is one),
//               the other hears it. Which ear loses it is random. The baseline is
//               given the default-settings ear, as an ordinary agent would be.
//   both-ears   both streams lose the same word. No check on text can recover
//               it, and the site says so; this condition measures that limit.
//
// Usage: node --env-file=.env eval/negbench.mjs --n 16 --seed 11
//        [--conditions clean,one-ear,both-ears] [--model qwen3.5-4b-32k-fast]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleEvidence, chat, discoverModel, extractJson, hasNegator, runDissent } from '@one-moment/core';
import { findInventedWords, isInverted } from './score.mjs';
import { degrade, hasNegation, seededRng, tokenize } from './spike/lib/degrade.js';

/**
 * Real Universal-3.5 Pro finals are formatted: capitalised and punctuated. A
 * benchmark that feeds lowercase, unpunctuated text would never exercise the
 * verbatim path a live call takes, so every transcript here is formatted the
 * way the stream would format it. The words keep their confidences.
 */
const formatted = (s) => {
  const t = s.trim();
  if (!t) return t;
  const c = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(c) ? c : `${c}.`;
};

// The scorer shared by every benchmark (score.mjs): framing, pronouns, negators
// and inflected forms are not counted as invented, for either arm.
const score = (relayed, groundTruth) => ({
  relayed,
  invented: findInventedWords(relayed, groundTruth),
  inverted: isInverted(relayed, groundTruth),
});

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
  return acc;
}, []));
const N = Number(argv.n ?? 20);
const SEED = Number(argv.seed ?? 11);
const CONDITIONS = (argv.conditions ?? 'clean,one-ear,both-ears').split(',');
const apiKey = process.env.ASSEMBLYAI_API_KEY;
if (!apiKey && !argv.rescore) throw new Error('ASSEMBLYAI_API_KEY is not set');

function loadHarvard() {
  const raw = fs.readFileSync(path.join(here, 'spike', 'fixtures', 'corpora', 'harvard.txt'), 'utf8');
  const out = [];
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim().replace(/^[0-9]+[).]?[ ]*/, '');
    if (!line || /^(List|#|Appendix)/i.test(line) || line.split(/ +/).length <= 3) continue;
    out.push(line);
  }
  return [...new Set(out)];
}

function pick(arr, k, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, k);
}

const turn = (words) => ({ type: 'Turn', turn_order: 0, end_of_turn: true, transcript: formatted(words.map((w) => w.text).join(' ')), words });

/**
 * One utterance as both listening streams report it, and the text an ordinary
 * single-stream agent (default settings, so the fast ear) would have been given.
 */
function makeCase(groundTruth, condition, rng) {
  if (condition === 'both-ears') {
    const { text, evidence } = degrade(groundTruth, 'dropped-function', rng);
    const patientWords = evidence.words.map((w) => ({ ...w }));
    // Both ears lost the word. They may still mishear other low-confidence words differently.
    const fastWords = evidence.words.map((w, i) => {
      const d = evidence.crossStreamDisagreement.find((x) => x.index === i);
      return { ...w, text: d ? d.fast : w.text };
    });
    return { patient: turn(patientWords), fast: turn(fastWords), baselineText: formatted(text) };
  }
  // Clean timings for the full sentence.
  const tokens = tokenize(groundTruth);
  let t = 400;
  const clear = tokens.map((text) => {
    const dur = 150 + Math.floor(rng() * 220);
    const w = { text, start: t, end: t + dur, confidence: +(0.9 + rng() * 0.09).toFixed(2) };
    t += dur + 60;
    return w;
  });
  if (condition === 'clean') {
    return { patient: turn(clear), fast: turn(clear.map((w) => ({ ...w }))), baselineText: formatted(tokens.join(' ')) };
  }
  // one-ear: drop the negator if there is one, else the first short function word, from one ear only.
  const NEG = ['not', 'no', "don't", 'dont', "doesn't", "won't", "can't", 'never', 'nothing', 'none', 'without'];
  let idx = tokens.findIndex((x) => NEG.includes(x));
  if (idx === -1) idx = tokens.findIndex((x) => ['the', 'a', 'to', 'of', 'and', 'is'].includes(x));
  if (idx === -1) idx = 0;
  const lossy = clear.filter((_, i) => i !== idx);
  const patientLoses = rng() < 0.5;
  const patient = turn(patientLoses ? lossy : clear);
  const fast = turn(patientLoses ? clear.map((w) => ({ ...w })) : lossy);
  return { patient, fast, baselineText: fast.transcript };
}

const BASELINE_SYSTEM = 'You are a voice assistant helping someone with a speech difficulty make a phone call. Interpret what they want and state it as a single clear sentence you would say to the other party. Output ONE line of JSON. No prose. No markdown. Schema: {"relay":"string"}';

async function baseline(model, text) {
  const r = await chat({ apiKey, model, maxRetries: 6 }, BASELINE_SYSTEM, `They said: "${text}"`, 150);
  const j = r.ok ? extractJson(r.content) : null;
  return { relayed: typeof j?.relay === 'string' && j.relay.trim() ? j.relay.trim() : null, ms: r.ms, ok: r.ok };
}

// --rescore <results.json>: recompute every score from the stored relays, with no API calls.
if (argv.rescore) {
  const prev = JSON.parse(fs.readFileSync(argv.rescore, 'utf8'));
  const rows = prev.rows.map((r) => ({
    ...r,
    hasNegation: hasNegator(r.groundTruth),
    baseline: { ...r.baseline, ...score(r.baseline.relayed, r.groundTruth) },
    full: { ...r.full, ...score(r.full.relayed, r.groundTruth) },
  }));
  finish({ ...prev, rescoredAt: new Date().toISOString() }, rows, prev.conditions);
  process.exit(0);
}

const model = argv.model ?? (await discoverModel({ apiKey }));
if (!model) throw new Error('No LLM Gateway model reachable');
const rng = seededRng(SEED);
const all = loadHarvard();
const negs = all.filter(hasNegation);
const pos = all.filter((c) => !hasNegation(c));
const cases = [...pick(negs, Math.ceil(N * 0.6), rng), ...pick(pos, Math.floor(N * 0.4), rng)];
console.log(`NEGBENCH on the product engine. model ${model}, ${cases.length} cases (${cases.filter(hasNegation).length} with a negation), conditions ${CONDITIONS.join(', ')}, seed ${SEED}`);

const rows = [];
let i = 0;
for (const groundTruth of cases) {
  for (const condition of CONDITIONS) {
    i++;
    const c = makeCase(groundTruth, condition, seededRng(SEED + i));
    const ev = assembleEvidence({ patient: c.patient, fastFinals: [c.fast] });
    const text = c.baselineText;
    const b = await baseline(model, text);
    const f = await runDissent(ev, { apiKey, model, mode: 'serial', live: false, maxRetries: 6, callerName: 'The caller' });
    const fullText = f.decision.action === 'relay' ? f.decision.text : null;
    const row = {
      groundTruth, condition, baselineHeard: text, patientHeard: ev.patientTranscript, fastHeard: ev.fastTranscript,
      hasNegation: hasNegator(groundTruth),
      baseline: { ...score(b.relayed, groundTruth), refused: !b.relayed, ms: b.ms },
      full: {
        ...score(fullText, groundTruth), refused: !fullText, rule: f.decision.policyRule, reason: f.decision.reason, ms: f.timings.totalMs,
        // What the models proposed, so every blocked case can be inspected.
        advocate: f.advocate?.say ?? null, skeptic: f.skeptic?.reading ?? null, blockedWords: f.deterministic.invented,
      },
    };
    rows.push(row);
    const tag = (a) => (a.refused ? 'asked' : a.inverted ? 'INVERTED' : a.invented.length ? `invented ${a.invented.join(',')}` : 'ok');
    console.log(`${String(i).padStart(3)} ${condition.padEnd(16)} base: ${tag(row.baseline).padEnd(22)} full: ${tag(row.full).padEnd(22)} rule ${f.decision.policyRule}  | ${groundTruth}`);
  }
}

finish({
  ranAt: new Date().toISOString(),
  engine: 'packages/core runDissent (the product)',
  source: 'Harvard Sentences, IEEE Std 297-1969, public domain',
  degradation: 'eval/negbench.mjs and eval/spike/lib/degrade.js, written by us',
  model, seed: SEED, cases: cases.length,
}, rows, CONDITIONS);

function finish(meta, rows, conditions) {
  const summarise = (arm, subset) => {
    const xs = subset.map((r) => r[arm]);
    const relayed = xs.filter((x) => !x.refused);
    const negRelayed = subset.filter((r) => r.hasNegation && !r[arm].refused);
    return {
      n: xs.length,
      relayed: relayed.length,
      asked: xs.length - relayed.length,
      withInventedWords: relayed.filter((x) => x.invented.length).length,
      negationCasesRelayed: negRelayed.length,
      negationFlipped: negRelayed.filter((r) => r[arm].inverted).length,
    };
  };
  const byCondition = Object.fromEntries(conditions.map((c) => {
    const sub = rows.filter((r) => r.condition === c);
    // Asked although the plain reading was fine: the baseline relayed something with
    // no invented words and no flipped meaning. That question was not needed.
    const overAsked = sub.filter((r) => r.full.refused && r.baseline.relayed && !r.baseline.invented.length && !r.baseline.inverted).length;
    return [c, { baseline: summarise('baseline', sub), full: summarise('full', sub), overAsked }];
  }));
  const result = { ...meta, conditions, byCondition, rows };
  const stamp = String(meta.ranAt).slice(0, 10);
  fs.mkdirSync(path.join(here, 'results'), { recursive: true });
  fs.writeFileSync(path.join(here, 'results', `negbench-${stamp}-seed${meta.seed}.json`), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(here, '..', 'apps', 'web', 'src', 'content', 'negbench.json'), JSON.stringify(result, null, 2));
  console.log('\n' + JSON.stringify(byCondition, null, 2));
}
