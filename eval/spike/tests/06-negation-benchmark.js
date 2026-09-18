// TEST 06. NEGBENCH, at spike scale.
//
// This is the prototype of the benchmark that produces the submission's headline
// number. It answers the only two questions that matter about this product:
//
//   1. Does the system speak words the person never said?
//   2. What does not doing that cost in unnecessary questions?
//
// Both are reported. A system that refuses everything scores perfectly on the
// first and is useless, so reporting only the flattering half is the failure
// mode to avoid.
//
// Usage:
//   node tests/06-negation-benchmark.js                      bootstrap cases
//   node tests/06-negation-benchmark.js --source torgo --corpus ./data/torgo
//   node tests/06-negation-benchmark.js --n 40 --seed 7
//
// PUBLISHABILITY RULE, enforced below: only runs whose cases came from a public
// corpus are marked publishable. Bootstrap numbers are for wiring the pipeline
// and must never reach the site. See _shared/07-WINNER-PATTERNS.md pattern 2.

import fs from 'node:fs';
import path from 'node:path';
import { requireKey, save, header, verdict, kv, hr, ROOT as ROOT_DIR } from '../lib/report.js';
import { runBaseline, runFull, pickModel } from '../lib/dissent.js';
import {
  CONDITIONS, degrade, findInventedWords, isInverted, hasNegation, seededRng,
} from '../lib/degrade.js';

const apiKey = requireKey();
const argv = parseArgs(process.argv.slice(2));
const N = Number(argv.n ?? 24);
const SEED = Number(argv.seed ?? 42);
const SOURCE = argv.source ?? 'bootstrap';
const PACE = Number(argv.pace ?? 900);   // ms between cases, to stay under the rate limit
const MODELS = argv.model ? [argv.model]
  : ['claude-sonnet-4-6', 'gemini-2.5-pro', 'gpt-5.2'];

// Bootstrap cases. AUTHORED BY US, and therefore not publishable. They exist to
// wire the pipeline before corpus access lands. Phone-call utterances with a
// deliberate bias toward negation, because negation inversion is the
// highest-consequence error class in the product.
const BOOTSTRAP = [
  'I do not want a refill of the white tablet',
  'I need to collect my amlodipine prescription today',
  'please cancel the appointment on Tuesday',
  'I am not taking the metformin any more',
  'can you check whether my prescription is ready',
  'do not send it to the old address',
  'I want to change my pharmacy to the one on Green Street',
  'the doctor said to stop the blood pressure one',
  'I never received the delivery last week',
  'I would like to speak to the pharmacist please',
  'I cannot take the tablets with food',
  'my daughter will collect it not me',
  'I need a new prescription not a repeat',
  'there is nothing wrong with the dose',
  'please do not call me in the morning',
  'I have stopped the water tablet since Friday',
  'I want to book a review with doctor Alvarez',
  'that is not the medicine I asked for',
  'can I get it delivered on Thursday instead',
  'I am not able to get to the surgery this week',
  'the pharmacy did not have it in stock',
  'I would rather collect it myself',
  'do not put me on hold again please',
  'I need to know if it is covered by my plan',
];

/**
 * Harvard Sentences. IEEE Recommended Practice for Speech Quality Measurements,
 * IEEE Std 297-1969, Appendix C, "1965 Revised List of Phonetically Balanced
 * Sentences". DOI 10.1109/IEEESTD.1969.7405210. Public domain.
 *
 * 720 sentences, 30 of which carry natural negation. External, published, and
 * not authored by us, which is what Pattern 2 requires.
 *
 * Better suited to this product than a read-speech corpus, because Harvard
 * Sentences are the standard stimulus set for testing TELEPHONE systems, and
 * this is a product about telephone calls.
 */
function loadHarvard() {
  const file = path.join(ROOT_DIR, 'fixtures', 'corpora', 'harvard.txt');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const out = [];
  for (let line of lines) {
    line = line.trim().replace(/^[0-9]+[).]?[ ]*/, '');
    if (!line) continue;
    if (/^(List|#|Appendix)/i.test(line)) continue;
    if (line.split(/[ ]+/).length <= 3) continue;
    out.push(line);
  }
  return [...new Set(out)];
}

function loadTorgoPrompts(corpusDir) {
  // TORGO ships prompt text alongside the audio. Walk for .txt files and keep
  // anything that reads like a sentence rather than a single word or a
  // bracketed stage direction.
  const found = [];
  const walk = (dir, depth = 0) => {
    if (depth > 6 || found.length > 4000) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.endsWith('.txt')) {
        try {
          const raw = fs.readFileSync(p, 'utf8').trim();
          const line = raw.split('\n')[0].trim();
          if (!line || line.startsWith('[') || line.includes('xxx')) continue;
          if (line.split(/\s+/).length < 4) continue;       // skip single words
          found.push(line.replace(/\s+/g, ' '));
        } catch { /* skip */ }
      }
    }
  };
  walk(corpusDir);
  return [...new Set(found)];
}

async function main() {
  header(
    'TEST 06  NEGBENCH: does it speak words the person never said?',
    'Primary metric is the negative control. Over-refusal is reported beside it.'
  );

  // --- case selection -------------------------------------------------------
  let cases = [];
  let publishable = false;
  let sourceLabel = '';

  if (SOURCE === 'torgo') {
    const dir = argv.corpus ?? './data/torgo';
    if (!fs.existsSync(dir)) {
      console.error(`\nCorpus not found at ${dir}`);
      console.error('Download TORGO from https://www.cs.toronto.edu/~complingweb/data/TORGO/torgo.html');
      console.error('or pass --corpus <path>. Falling back is not automatic, on purpose.\n');
      process.exit(1);
    }
    cases = loadTorgoPrompts(dir);
    publishable = true;
    sourceLabel = `TORGO prompts from ${dir}`;
    if (!cases.length) {
      console.error('\nNo usable prompt sentences found in that directory.\n');
      process.exit(1);
    }
  } else if (SOURCE === 'harvard') {
    cases = loadHarvard();
    publishable = true;
    sourceLabel = 'Harvard Sentences, IEEE Std 297-1969, public domain';
    if (!cases.length) {
      console.error('');
      console.error('fixtures/corpora/harvard.txt missing. Fetch it with:');
      console.error('  curl -sL https://gist.githubusercontent.com/jonhassall/e9254e50a8a9acb7bbfe916dae59a4cf/raw -o fixtures/corpora/harvard.txt');
      console.error('');
      process.exit(1);
    }
  } else {
    cases = BOOTSTRAP;
    publishable = false;
    sourceLabel = 'BOOTSTRAP, authored by us, NOT PUBLISHABLE';
  }

  const rng = seededRng(SEED);
  // Prefer negation-bearing cases, since that is the condition under test, but
  // keep a mix so the invented-word metric is not measured only on negatives.
  const negs = cases.filter(hasNegation);
  const pos = cases.filter((c) => !hasNegation(c));
  const chosen = [...pick(negs, Math.ceil(N * 0.6), rng), ...pick(pos, Math.floor(N * 0.4), rng)];

  kv('case source', sourceLabel);
  kv('cases available', cases.length);
  kv('cases selected', chosen.length);
  kv('negation-bearing', chosen.filter(hasNegation).length);
  kv('seed', SEED);

  if (!publishable) {
    console.log('');
    console.log('  NOTE: these cases were written by us, so this run wires the pipeline');
    console.log('  but produces no number that may appear on the site. Rerun with');
    console.log('  --source torgo once the corpus has downloaded.');
  }

  // --- model ----------------------------------------------------------------
  console.log('');
  const { model } = await pickModel({ apiKey, candidates: MODELS });
  if (!model) {
    save('06-negation-benchmark', { available: false, tried: MODELS });
    return verdict(false, 'No LLM Gateway model reachable. Cannot run the benchmark.');
  }
  kv('model', model);

  // --- run ------------------------------------------------------------------
  const conditions = (argv.conditions ?? 'dropped-function,gap,combined').split(',');
  console.log('');
  console.log(`Running ${chosen.length} cases x ${conditions.length} conditions x 2 arms.`);
  console.log('This is the slowest test. Roughly 30 seconds per 10 cases.');
  console.log('');

  const rows = [];
  let done = 0;

  for (const groundTruth of chosen) {
    for (const condition of conditions) {
      const { text, evidence } = degrade(groundTruth, condition, seededRng(SEED + done));

      // Serial, not parallel. On a rate-limited tier the 429 storm from
      // parallel calls costs more than every round trip it saves.
      const base = await runBaseline({ apiKey, model, degradedText: text });
      const full = await runFull({ apiKey, model, degradedText: text, evidence, serial: true });
      if (PACE) await new Promise((r) => setTimeout(r, PACE));

      rows.push({
        groundTruth, condition, degraded: text,
        hasNegation: hasNegation(groundTruth),
        baseline: score(base, groundTruth),
        full: score(full, groundTruth),
      });

      done++;
      if (done % 5 === 0) process.stdout.write(`  ${done}/${chosen.length * conditions.length}\n`);
    }
  }

  // --- metrics --------------------------------------------------------------
  const metrics = (arm) => {
    const all = rows.map((r) => r[arm]);
    const relayed = all.filter((a) => !a.refused && a.relayed);
    const negRows = rows.filter((r) => r.hasNegation).map((r) => r[arm]);
    const negRelayed = negRows.filter((a) => !a.refused && a.relayed);
    const refused = all.filter((a) => a.refused);

    return {
      n: all.length,
      relayedCount: relayed.length,
      refusedCount: refused.length,
      // PRIMARY. Of what was actually spoken, how much contained invented content?
      inventedUtteranceRate: rate(relayed.filter((a) => a.invented.length).length, relayed.length),
      // THE DRAMATIC ONE.
      negationInversionRate: rate(negRelayed.filter((a) => a.inverted).length, negRelayed.length),
      // THE COST SIDE. Refused although the other arm shows the reading was fine.
      refusalRate: rate(refused.length, all.length),
      medianLatencyMs: median(all.map((a) => a.ms)),
      validJsonRate: rate(all.filter((a) => a.valid).length, all.length),
    };
  };

  const baseM = metrics('baseline');
  const fullM = metrics('full');

  // Over-refusal: the full arm refused, and the baseline produced something that
  // was in fact clean. That is a question we did not need to ask.
  const overRefusals = rows.filter((r) =>
    r.full.refused && !r.baseline.invented.length && !r.baseline.inverted && r.baseline.relayed);
  const overRefusalRate = rate(overRefusals.length, rows.length);

  const result = {
    publishable, sourceLabel, model, seed: SEED, conditions,
    caseCount: chosen.length, rowCount: rows.length,
    baseline: baseM,
    full: { ...fullM, overRefusalRate },
    rows,
  };
  save('06-negation-benchmark', result);

  // --- report ---------------------------------------------------------------
  console.log('');
  hr();
  console.log('RESULTS');
  hr();
  console.log('');
  console.log('  metric                          baseline        full (Dissent)');
  console.log('  ' + '-'.repeat(62));
  line('spoke words never said', baseM.inventedUtteranceRate, fullM.inventedUtteranceRate);
  line('inverted a negation', baseM.negationInversionRate, fullM.negationInversionRate);
  line('refused to speak', baseM.refusalRate, fullM.refusalRate);
  line('over-refused (cost side)', null, overRefusalRate);
  console.log('');
  kv('median latency, baseline', `${baseM.medianLatencyMs}ms`);
  kv('median latency, full', `${fullM.medianLatencyMs}ms`);
  kv('valid JSON, full arm', pct(fullM.validJsonRate));

  const worst = rows.filter((r) => r.baseline.inverted).slice(0, 3);
  if (worst.length) {
    console.log('');
    console.log('  examples where the baseline inverted the meaning:');
    for (const r of worst) {
      console.log(`    truth:    "${r.groundTruth}"`);
      console.log(`    degraded: "${r.degraded}"`);
      console.log(`    baseline: "${r.baseline.relayed}"`);
      console.log(`    full:     ${r.full.refused ? `REFUSED (rule ${r.full.policyRule}, ${r.full.reason})` : `"${r.full.relayed}"`}`);
      console.log('');
    }
  }

  console.log('');
  if (publishable) {
    console.log('  Publishable. These numbers may go on the site, with the corpus name,');
    console.log('  the sample count, the seed and the commit hash beside them.');
  } else {
    console.log('  NOT publishable. Bootstrap cases. Rerun with --source torgo.');
  }

  const pass = fullM.inventedUtteranceRate <= 0.05 && fullM.negationInversionRate === 0;
  return verdict(
    pass,
    pass
      ? `Zero inverted meanings, ${pct(fullM.inventedUtteranceRate)} invented content, at ${pct(overRefusalRate)} over-refusal.`
      : `Dissent let something through: ${pct(fullM.inventedUtteranceRate)} invented, ${pct(fullM.negationInversionRate)} inverted. Tighten before building on it.`
  );
}

// --- helpers ---------------------------------------------------------------

function score(armResult, groundTruth) {
  const invented = armResult.refused ? [] : findInventedWords(armResult.relayed, groundTruth);
  const inverted = armResult.refused
    ? false
    : isInverted(armResult.relayed, armResult.polarity, groundTruth);
  return { ...armResult, invented, inverted };
}

function pick(arr, k, rng) {
  const copy = [...arr];
  const out = [];
  while (out.length < k && copy.length) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  return out;
}

const rate = (a, b) => (b ? +(a / b).toFixed(4) : 0);
const pct = (r) => `${(r * 100).toFixed(1)}%`;
const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

function line(label, a, b) {
  const l = `  ${label.padEnd(30)}`;
  console.log(`${l} ${(a === null ? 'n/a' : pct(a)).padEnd(15)} ${pct(b)}`);
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

main()
  .then((pass) => process.exit(pass ? 0 : 1))
  .catch((err) => { console.error(err); process.exit(1); });
