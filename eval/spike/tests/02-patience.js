// TEST 02. Does the patience window actually hold?
//
// The product's headline claim is that a 6-second word-finding block does not
// end the speaker's turn. This test proves or disproves it by streaming the same
// audio through the patient configuration and through defaults, and counting how
// many turns each one produced.
//
// Expected: baseline splits the sentence into two or more turns at the gap.
//           patient keeps it as one turn.
//
// If both split, the patience parameter is not doing what the docs say, and the
// whole premise of One Moment is wrong. That is worth knowing on day one.

import { readWav, durationMs } from '../lib/wav.js';
import { openSession, streamRealtime, closeSession, fullTranscript } from '../lib/aai.js';
import { buildConfigs, describe } from '../lib/configs.js';
import { requireKey, fixture, save, load, header, verdict, kv, hr } from '../lib/report.js';

const apiKey = requireKey();
const discovery = load('00-connect');
if (!discovery?.minSilenceKey) {
  console.error('\nRun test 00 first:  npm run test:00\n');
  process.exit(1);
}

async function runOne(label, config, pcm) {
  const session = openSession({ apiKey, config, label });
  await session.ready;
  const stream = await streamRealtime(session, pcm);
  const state = await closeSession(session, { drainMs: 12000 });

  const finals = state.finalTurns.map((t) => ({
    at: t.at,
    transcript: t.raw.transcript ?? '',
    endOfTurnConfidence: t.raw.end_of_turn_confidence ?? null,
  }));

  return {
    label,
    config,
    turnCount: state.turns.length,
    finalCount: finals.length,
    finals,
    transcript: fullTranscript(state),
    driftMs: stream.driftMs,
    errors: state.errors,
  };
}

async function main() {
  header(
    'TEST 02  The patience window',
    'Does a 6-second mid-sentence pause survive, or does it end the turn?'
  );

  const file = fixture('pause-6s');
  const { pcm } = readWav(file);

  const { patient, baseline } = buildConfigs({
    model: discovery.model,
    minSilenceKey: discovery.minSilenceKey,
  });
  for (const key of discovery.unsupported) { delete patient[key]; delete baseline[key]; }

  kv('fixture', file.split(/[\\/]/).pop());
  kv('audio duration', `${(durationMs(pcm) / 1000).toFixed(2)}s`);
  kv('designed gap', '6000ms, mid-sentence');
  console.log('');
  console.log('  baseline: ' + describe(baseline));
  console.log('  patient:  ' + describe(patient));

  console.log('');
  console.log('Run 1 of 2: baseline (what any other voice agent ships)...');
  const base = await runOne('baseline', baseline, pcm);

  console.log('Run 2 of 2: patient (what One Moment ships)...');
  const pat = await runOne('patient', patient, pcm);

  const result = {
    gapMs: 6000,
    baseline: base,
    patient: pat,
    baselineSplit: base.finalCount >= 2,
    patientHeld: pat.finalCount === 1,
  };
  save('02-patience', result);

  console.log('');
  hr();
  console.log('RESULTS');
  hr();
  kv('baseline final turns', `${base.finalCount}  ${base.finalCount >= 2 ? '(split at the gap, as expected)' : ''}`);
  kv('patient final turns', `${pat.finalCount}  ${pat.finalCount === 1 ? '(held through the gap)' : ''}`);

  console.log('');
  console.log('  baseline produced:');
  for (const f of base.finals) console.log(`    +${String(f.at).padStart(6)}ms  "${f.transcript}"`);
  console.log('  patient produced:');
  for (const f of pat.finals) console.log(`    +${String(f.at).padStart(6)}ms  "${f.transcript}"`);

  console.log('');
  kv('baseline transcript', `"${base.transcript}"`);
  kv('patient transcript', `"${pat.transcript}"`);

  const pass = result.baselineSplit && result.patientHeld;

  console.log('');
  if (pass) {
    console.log('  This is the product, demonstrated in one number:');
    console.log(`  the same audio became ${base.finalCount} fragments on defaults`);
    console.log(`  and ${pat.finalCount} complete sentence with the patience window.`);
  } else if (!result.baselineSplit) {
    console.log('  The baseline did NOT split. Either the gap was too short for the');
    console.log('  server default, or defaults are more patient than documented.');
    console.log('  Try regenerating fixtures with a longer gap before concluding.');
  } else if (!result.patientHeld) {
    console.log('  The patient configuration did NOT hold the turn. This is the');
    console.log('  result that would force a redesign. Check which parameters test 00');
    console.log('  reported as unsupported, and read the raw turns in');
    console.log('  results/02-patience.json before deciding anything.');
  }

  return verdict(
    pass,
    pass
      ? 'The patience window works. This is the core claim, now measured.'
      : 'The patience behaviour is not what the design assumes. Read the JSON.'
  );
}

main()
  .then((pass) => process.exit(pass ? 0 : 1))
  .catch((err) => { console.error(err); process.exit(1); });
