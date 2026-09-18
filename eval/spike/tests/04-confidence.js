// TEST 04. Is the evidence layer actually available?
//
// The Dissent engine does not work on a string. It works on per-word confidence,
// word start and end timestamps, and turn-level end_of_turn_confidence. If those
// fields are absent or null in practice, the Skeptic has nothing to attack with
// and the whole grounding design collapses into "ask a second model to agree".
//
// This test inspects real Turn messages and reports exactly which fields arrive,
// on partials as well as finals, and derives the gap profile that the Floor
// Controller uses to tell "stuck" from "finished".

import { readWav } from '../lib/wav.js';
import { openSession, streamRealtime, closeSession } from '../lib/aai.js';
import { buildConfigs } from '../lib/configs.js';
import { requireKey, fixture, save, load, header, verdict, kv, hr } from '../lib/report.js';

const apiKey = requireKey();
const discovery = load('00-connect');
if (!discovery?.minSilenceKey) {
  console.error('\nRun test 00 first:  npm run test:00\n');
  process.exit(1);
}

async function main() {
  header(
    'TEST 04  The evidence layer',
    'Word confidence, word timings, and the derived gap profile.'
  );

  const file = fixture('pause-6s');
  const { pcm } = readWav(file);

  const { patient } = buildConfigs({
    model: discovery.model,
    minSilenceKey: discovery.minSilenceKey,
  });
  for (const key of discovery.unsupported) delete patient[key];

  const session = openSession({ apiKey, config: patient, label: 'evidence' });
  await session.ready;
  console.log('Streaming and collecting every Turn message...');
  await streamRealtime(session, pcm);
  const state = await closeSession(session, { drainMs: 12000 });

  const partials = state.turns.filter((t) => !t.raw.end_of_turn);
  const finals = state.finalTurns;

  const has = (turns, pred) => turns.filter((t) => pred(t.raw)).length;

  const wordsOnPartials = has(partials, (m) => Array.isArray(m.words) && m.words.length > 0);
  const wordsOnFinals = has(finals, (m) => Array.isArray(m.words) && m.words.length > 0);

  const confOnPartials = has(partials, (m) =>
    (m.words ?? []).some((w) => typeof w.confidence === 'number'));
  const confOnFinals = has(finals, (m) =>
    (m.words ?? []).some((w) => typeof w.confidence === 'number'));

  const timingsOnFinals = has(finals, (m) =>
    (m.words ?? []).some((w) => typeof w.start === 'number' && typeof w.end === 'number'));

  const eotConfidence = state.turns
    .map((t) => t.raw.end_of_turn_confidence)
    .filter((v) => typeof v === 'number');

  const wordIsFinalPresent = has(state.turns, (m) =>
    (m.words ?? []).some((w) => typeof w.word_is_final === 'boolean'));

  // Every word we ever saw, for confidence statistics.
  const allWords = [];
  for (const t of finals) for (const w of t.raw.words ?? []) allWords.push(w);
  const confs = allWords.map((w) => w.confidence).filter((c) => typeof c === 'number');

  // The gap profile. This is the single most important derived signal in the
  // product: a long gap BETWEEN words is a word-finding block, not an ending.
  const gaps = [];
  for (const t of finals) {
    const ws = (t.raw.words ?? []).filter((w) => typeof w.start === 'number');
    for (let i = 1; i < ws.length; i++) {
      const gap = ws[i].start - ws[i - 1].end;
      if (gap > 0) gaps.push({ afterWord: ws[i - 1].text, beforeWord: ws[i].text, gapMs: gap });
    }
  }
  gaps.sort((a, b) => b.gapMs - a.gapMs);

  // Revision churn: how often a token changed across partials before settling.
  const partialTexts = partials.map((t) => (t.raw.transcript ?? '').trim()).filter(Boolean);
  let churn = 0;
  for (let i = 1; i < partialTexts.length; i++) {
    if (!partialTexts[i].startsWith(partialTexts[i - 1])) churn++;
  }

  const result = {
    turnCount: state.turns.length,
    partialCount: partials.length,
    finalCount: finals.length,
    fields: {
      wordsOnPartials, wordsOnFinals,
      confidenceOnPartials: confOnPartials,
      confidenceOnFinals: confOnFinals,
      timingsOnFinals,
      endOfTurnConfidenceCount: eotConfidence.length,
      wordIsFinalPresent,
    },
    confidence: confs.length ? {
      count: confs.length,
      min: Math.min(...confs),
      max: Math.max(...confs),
      mean: +(confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(4),
    } : null,
    largestGaps: gaps.slice(0, 8),
    churnEvents: churn,
    sampleFinalTurn: finals[0]?.raw ?? null,
  };
  save('04-confidence', result);

  console.log('');
  hr();
  console.log('RESULTS');
  hr();
  kv('turns (partial / final)', `${partials.length} / ${finals.length}`);
  console.log('');
  console.log('  field availability:');
  kv('  words[] on partials', wordsOnPartials ? `yes (${wordsOnPartials} turns)` : 'NO');
  kv('  words[] on finals', wordsOnFinals ? `yes (${wordsOnFinals} turns)` : 'NO');
  kv('  word.confidence on partials', confOnPartials ? `yes (${confOnPartials} turns)` : 'NO');
  kv('  word.confidence on finals', confOnFinals ? `yes (${confOnFinals} turns)` : 'NO');
  kv('  word.start / word.end', timingsOnFinals ? `yes (${timingsOnFinals} turns)` : 'NO');
  kv('  word.word_is_final', wordIsFinalPresent ? `yes (${wordIsFinalPresent} turns)` : 'NO');
  kv('  end_of_turn_confidence', eotConfidence.length ? `yes (${eotConfidence.length} turns)` : 'NO');

  if (result.confidence) {
    console.log('');
    kv('word confidence min/mean/max',
      `${result.confidence.min} / ${result.confidence.mean} / ${result.confidence.max}`);
  }

  if (gaps.length) {
    console.log('');
    console.log('  largest inter-word gaps (the word-finding block signal):');
    for (const g of gaps.slice(0, 5)) {
      const flag = g.gapMs >= 2000 ? '  <-- block' : '';
      console.log(`    ${String(g.gapMs).padStart(6)}ms  after "${g.afterWord}" before "${g.beforeWord}"${flag}`);
    }
  }

  console.log('');
  kv('partial revision churn events', churn);

  // What Dissent minimally needs: per-word confidence and timings on finals.
  const dissentViable = confOnFinals > 0 && timingsOnFinals > 0;
  const floorControllerViable = gaps.some((g) => g.gapMs >= 2000) || eotConfidence.length > 0;

  console.log('');
  kv('Dissent has evidence to work with', dissentViable ? 'yes' : 'NO');
  kv('Floor Controller has a gap signal', floorControllerViable ? 'yes' : 'NO');

  if (!confOnPartials) {
    console.log('');
    console.log('  Note: no confidence on partials. The design can fall back to');
    console.log('  revision churn for live uncertainty. Record this in the plan.');
  }

  const pass = dissentViable && floorControllerViable;
  return verdict(
    pass,
    pass
      ? 'The evidence layer is real. Dissent and the Floor Controller are buildable.'
      : 'Missing fields the design depends on. Read results/04-confidence.json.'
  );
}

main()
  .then((pass) => process.exit(pass ? 0 : 1))
  .catch((err) => { console.error(err); process.exit(1); });
