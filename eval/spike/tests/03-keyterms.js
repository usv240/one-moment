// TEST 03. Does bringing your own vocabulary actually change the output, and
// does the unboosted control catch it when the bias goes too far?
//
// Two claims are under test, and they pull in opposite directions:
//
//   1. keyterms_prompt improves recognition of the user's personal vocabulary.
//      This is the entire BYO-data story, and the zero-enrolment alternative to
//      training an acoustic model per user.
//
//   2. That same bias can force a term the speaker did not say. A system that
//      biases the decoder without checking the bias is LESS safe than one that
//      does not bias at all.
//
// The second claim is why the design runs an unboosted control stream. This test
// measures both effects on the same audio.

import { readWav } from '../lib/wav.js';
import { openSession, streamRealtime, closeSession, fullTranscript, latestTranscript } from '../lib/aai.js';
import { BASE } from '../lib/configs.js';
import { requireKey, fixture, save, load, header, verdict, kv, hr } from '../lib/report.js';

const apiKey = requireKey();
const discovery = load('00-connect');
if (!discovery) {
  console.error('\nRun test 00 first:  npm run test:00\n');
  process.exit(1);
}

if (discovery.unsupported.includes('keyterms_prompt')) {
  console.log('\nTest 00 reported keyterms_prompt as unsupported on this account.');
  console.log('Skipping. The BYO-lexicon design needs an alternative, see README.\n');
  save('03-keyterms', { skipped: true, reason: 'keyterms_prompt not accepted' });
  process.exit(0);
}

// Terms a real user would have in their lexicon. "amlodipine" and "metformin"
// are genuinely in the audio. The distractors are NOT, and exist to detect
// whether boosting can hallucinate a term into a transcript.
const REAL_TERMS = ['amlodipine', 'metformin'];
const DISTRACTORS = ['atorvastatin', 'levothyroxine', 'furosemide'];

async function runOne(label, config, pcm) {
  const session = openSession({ apiKey, config, label });
  await session.ready;
  const stream = await streamRealtime(session, pcm);
  const state = await closeSession(session, { drainMs: 8000 });
  const text = fullTranscript(state) || latestTranscript(state);

  const words = [];
  for (const t of state.finalTurns) for (const w of t.raw.words ?? []) {
    words.push({ text: w.text, confidence: w.confidence ?? null });
  }

  return { label, config, transcript: text, words, driftMs: stream.driftMs, errors: state.errors };
}

async function main() {
  header(
    'TEST 03  Bring your own vocabulary, and its risk',
    'Does keyterms_prompt help, and can it force a word that was never spoken?'
  );

  const file = fixture('lexicon');
  const { pcm } = readWav(file);
  const model = discovery.model ? { speech_model: discovery.model } : {};

  const boosted = { ...BASE, ...model, keyterms_prompt: [...REAL_TERMS, ...DISTRACTORS] };
  const unboosted = { ...BASE, ...model };

  kv('fixture', file.split(/[\\/]/).pop());
  kv('spoken drug names', REAL_TERMS.join(', '));
  kv('boosted terms', [...REAL_TERMS, ...DISTRACTORS].join(', '));
  kv('distractors (not spoken)', DISTRACTORS.join(', '));

  console.log('');
  console.log('Run 1 of 2: unboosted control...');
  const un = await runOne('unboosted', unboosted, pcm);

  console.log('Run 2 of 2: boosted with the user lexicon...');
  const bo = await runOne('boosted', boosted, pcm);

  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const unText = norm(un.transcript);
  const boText = norm(bo.transcript);

  const found = (text, term) => text.includes(term.toLowerCase());

  const realRecovered = REAL_TERMS.map((t) => ({
    term: t,
    unboosted: found(unText, t),
    boosted: found(boText, t),
  }));

  const falseBoosts = DISTRACTORS.filter((t) => found(boText, t));

  const result = {
    unboosted: un,
    boosted: bo,
    realRecovered,
    falseBoosts,
    lift: realRecovered.filter((r) => r.boosted && !r.unboosted).length,
    regression: realRecovered.filter((r) => !r.boosted && r.unboosted).length,
    transcriptsDiffer: unText !== boText,
  };
  save('03-keyterms', result);

  console.log('');
  hr();
  console.log('RESULTS');
  hr();
  console.log('  unboosted: "' + un.transcript + '"');
  console.log('  boosted:   "' + bo.transcript + '"');
  console.log('');
  kv('transcripts differ', result.transcriptsDiffer ? 'yes (bias has an effect)' : 'no');

  console.log('');
  console.log('  per-term recovery:');
  for (const r of realRecovered) {
    const tag = r.boosted && !r.unboosted ? 'RECOVERED BY LEXICON'
      : r.boosted && r.unboosted ? 'both got it'
        : !r.boosted && r.unboosted ? 'REGRESSION'
          : 'neither got it';
    console.log(`    ${r.term.padEnd(16)} unboosted=${String(r.unboosted).padEnd(5)} boosted=${String(r.boosted).padEnd(5)}  ${tag}`);
  }

  console.log('');
  kv('terms recovered by lexicon', result.lift);
  kv('false boosts (never spoken)', falseBoosts.length ? falseBoosts.join(', ') : 'none');

  console.log('');
  if (falseBoosts.length) {
    console.log('  A distractor appeared that was never spoken. This is exactly the');
    console.log('  risk the design predicted, and exactly why the unboosted control');
    console.log('  stream exists. Report this number on the site as falseBoostRate.');
  } else {
    console.log('  No false boosts on this clip. Do not over-claim from one sample.');
    console.log('  The evaluation harness runs this across a whole corpus.');
  }

  // Passing means the mechanism works at all and we can measure both directions.
  const pass = !un.errors.length && !bo.errors.length && result.transcriptsDiffer;
  return verdict(
    pass,
    pass
      ? 'Vocabulary biasing is measurable in both directions. BYO-lexicon is viable.'
      : 'Boosting produced no measurable difference on this clip. Try a harder fixture.'
  );
}

main()
  .then((pass) => process.exit(pass ? 0 : 1))
  .catch((err) => { console.error(err); process.exit(1); });
