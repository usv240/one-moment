// TEST 01. THE TEST.
//
// The entire One Moment architecture rests on one claim: you can run two
// concurrent AssemblyAI streaming sessions on the same microphone, with
// deliberately different configurations, and use their disagreement as an
// honest uncertainty signal.
//
// If this fails, the plan changes tonight. Nothing else in the build matters
// until this is answered.
//
// What we measure:
//   1. Do two sessions on one key open concurrently at all?
//   2. Do both transcribe the same audio?
//   3. What does the second session cost in latency?
//   4. Do the two configurations actually produce different output?

import { readWav, durationMs } from '../lib/wav.js';
import { openSession, streamRealtime, closeSession, fullTranscript, latestTranscript } from '../lib/aai.js';
import { buildConfigs, describe } from '../lib/configs.js';
import { requireKey, fixture, save, load, header, verdict, kv, hr } from '../lib/report.js';

const apiKey = requireKey();

const discovery = load('00-connect');
if (!discovery?.minSilenceKey) {
  console.error('\nRun test 00 first:  npm run test:00\n');
  process.exit(1);
}

const KEYTERMS = ['amlodipine', 'metformin', 'prescription', 'refill'];

async function main() {
  header(
    'TEST 01  Two concurrent streaming sessions on one microphone',
    'The assumption the whole architecture depends on.'
  );

  const file = fixture('pause-6s');
  const { pcm, sampleRate } = readWav(file);
  if (sampleRate !== 16000) {
    console.error(`Fixture is ${sampleRate}Hz. It must be 16000Hz mono.`);
    process.exit(1);
  }

  const { patient, fast } = buildConfigs({
    model: discovery.model,
    minSilenceKey: discovery.minSilenceKey,
    keyterms: discovery.unsupported.includes('keyterms_prompt') ? null : KEYTERMS,
  });

  for (const key of discovery.unsupported) { delete patient[key]; delete fast[key]; }

  kv('fixture', file.split(/[\\/]/).pop());
  kv('audio duration', `${(durationMs(pcm) / 1000).toFixed(2)}s`);
  console.log('');
  console.log('  patient:  ' + describe(patient));
  console.log('  fast:     ' + describe(fast));
  console.log('');

  // Open both, concurrently. Both must reach Begin before either sends audio,
  // otherwise we would be measuring a staggered start rather than a shared one.
  console.log('Opening both sessions concurrently...');
  const openedAt = Date.now();

  const pSession = openSession({ apiKey, config: patient, label: 'patient', verbose: true });
  const fSession = openSession({ apiKey, config: fast, label: 'fast', verbose: true });

  let bothOpen = false;
  let openError = null;
  try {
    await Promise.all([pSession.ready, fSession.ready]);
    bothOpen = true;
  } catch (err) {
    openError = err.message;
  }

  if (!bothOpen) {
    console.log('');
    kv('concurrent open', `FAILED: ${openError}`);
    try { pSession.ws.close(); } catch { /* ignore */ }
    try { fSession.ws.close(); } catch { /* ignore */ }

    save('01-dual-stream', { bothOpen: false, openError });

    console.log('');
    console.log('  This is the result that changes the plan. Read spike/README.md');
    console.log('  section "If test 01 fails" before building anything else.');
    return verdict(false, 'Two concurrent sessions did NOT open. The architecture must change.');
  }

  kv('concurrent open', `both reached Begin in ${Date.now() - openedAt}ms`);
  kv('patient session id', pSession.state.beginMessage?.id ?? '(none)');
  kv('fast session id', fSession.state.beginMessage?.id ?? '(none)');

  // Feed the identical buffer to both, in real time, from one loop so neither
  // gets a timing advantage.
  console.log('');
  console.log(`Streaming ${(durationMs(pcm) / 1000).toFixed(1)}s of audio to both, in real time...`);
  console.log('');

  const streamStart = Date.now();
  const [pStream, fStream] = await Promise.all([
    streamRealtime(pSession, pcm, { verbose: false }),
    streamRealtime(fSession, pcm, { verbose: false }),
  ]);

  // Drain. The patient stream may still be holding the turn open by design.
  console.log('');
  console.log('Draining (the patient stream may still be holding its turn open)...');
  const [pState, fState] = await Promise.all([
    closeSession(pSession, { drainMs: 12000 }),
    closeSession(fSession, { drainMs: 12000 }),
  ]);

  const elapsed = Date.now() - streamStart;

  // Measurements
  const pFirst = pState.turns[0]?.at ?? null;
  const fFirst = fState.turns[0]?.at ?? null;

  const pText = fullTranscript(pState) || latestTranscript(pState);
  const fText = fullTranscript(fState) || latestTranscript(fState);

  const result = {
    bothOpen: true,
    concurrentOpenMs: Date.now() - openedAt,
    audioDurationMs: Math.round(durationMs(pcm)),
    wallClockMs: elapsed,
    patient: summarise(pState, pStream, patient),
    fast: summarise(fState, fStream, fast),
    firstTurnLatency: { patientMs: pFirst, fastMs: fFirst, deltaMs: delta(pFirst, fFirst) },
    transcripts: { patient: pText, fast: fText },
    identical: normalise(pText) === normalise(fText),
    tokenDisagreement: diffTokens(pText, fText),
  };

  save('01-dual-stream', result);

  // Report
  console.log('');
  hr();
  console.log('RESULTS');
  hr();
  kv('both sessions opened', 'yes');
  kv('patient: turns / finals', `${pState.turns.length} / ${pState.finalTurns.length}`);
  kv('fast: turns / finals', `${fState.turns.length} / ${fState.finalTurns.length}`);
  kv('patient: first turn at', pFirst === null ? '(never)' : `+${pFirst}ms`);
  kv('fast: first turn at', fFirst === null ? '(never)' : `+${fFirst}ms`);
  kv('first-turn latency delta', result.firstTurnLatency.deltaMs === null
    ? 'n/a' : `${result.firstTurnLatency.deltaMs}ms`);
  kv('patient: send drift', `${pStream.driftMs}ms`);
  kv('fast: send drift', `${fStream.driftMs}ms`);
  kv('patient errors', pState.errors.length);
  kv('fast errors', fState.errors.length);

  console.log('');
  console.log('  patient transcript:');
  console.log(`    "${pText || '(nothing)'}"`);
  console.log('  fast transcript:');
  console.log(`    "${fText || '(nothing)'}"`);

  if (result.tokenDisagreement.length) {
    console.log('');
    console.log('  cross-stream disagreement (this is the signal the design uses):');
    for (const d of result.tokenDisagreement.slice(0, 12)) {
      console.log(`    position ${String(d.index).padStart(2)}  patient="${d.patient}"  fast="${d.fast}"`);
    }
  } else {
    console.log('');
    console.log('  No token disagreement on this clip. That is fine and expected');
    console.log('  on clean synthetic speech. Test 03 forces a disagreement.');
  }

  const bothTranscribed = pState.turns.length > 0 && fState.turns.length > 0;
  const noErrors = pState.errors.length === 0 && fState.errors.length === 0;
  const driftOk = Math.abs(pStream.driftMs) < 1500 && Math.abs(fStream.driftMs) < 1500;

  console.log('');
  kv('both produced transcripts', bothTranscribed ? 'yes' : 'NO');
  kv('no stream errors', noErrors ? 'yes' : 'NO');
  kv('real-time pacing held', driftOk ? 'yes' : `NO (drift too high, results unreliable)`);

  const pass = bothOpen && bothTranscribed && noErrors && driftOk;
  return verdict(
    pass,
    pass
      ? 'Dual-stream architecture is REAL. Build it. Proceed to test 02.'
      : 'Sessions opened but did not behave. Read results/01-dual-stream.json before proceeding.'
  );
}

function summarise(state, stream, config) {
  return {
    config,
    openedAtMs: state.openedAt,
    turnCount: state.turns.length,
    finalTurnCount: state.finalTurns.length,
    framesSent: stream.framesSent,
    driftMs: stream.driftMs,
    errors: state.errors,
    closeCode: state.closeCode,
    termination: state.terminationMessage,
    turns: state.turns.map((t) => ({
      at: t.at,
      endOfTurn: !!t.raw.end_of_turn,
      endOfTurnConfidence: t.raw.end_of_turn_confidence ?? null,
      transcript: t.raw.transcript ?? '',
      wordCount: t.raw.words?.length ?? 0,
    })),
  };
}

const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const delta = (a, b) => (a === null || b === null ? null : a - b);

function diffTokens(a, b) {
  const ta = normalise(a).split(' ').filter(Boolean);
  const tb = normalise(b).split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    if (ta[i] !== tb[i]) out.push({ index: i, patient: ta[i] ?? '(none)', fast: tb[i] ?? '(none)' });
  }
  return out;
}

main()
  .then((pass) => process.exit(pass ? 0 : 1))
  .catch((err) => { console.error(err); process.exit(1); });
