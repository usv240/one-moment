// Test 00: can we connect at all, and what are the parameters actually called?
//
// Published examples disagree on the spelling of the short-silence parameter and
// on the speech model identifier. Rather than guessing, probe. Whatever works is
// written to results/00-connect.json and every later test reads it from there.

import { openSession, closeSession, sleep } from '../lib/aai.js';
import { BASE, MIN_SILENCE_KEYS, MODEL_CANDIDATES } from '../lib/configs.js';
import { requireKey, save, header, verdict, kv } from '../lib/report.js';

const apiKey = requireKey();

async function probe(label, config) {
  let session;
  try {
    session = openSession({ apiKey, config, label });
    await session.ready;
    const begin = session.state.beginMessage;
    await closeSession(session, { drainMs: 2000 });
    return { ok: true, begin };
  } catch (err) {
    if (session) { try { session.ws.close(); } catch { /* ignore */ } }
    return { ok: false, error: err.message };
  }
}

async function main() {
  header(
    'TEST 00  Connectivity and parameter discovery',
    'Finds a working speech model and the real spelling of the turn parameters.'
  );

  const result = {
    connected: false,
    model: null,
    minSilenceKey: null,
    sessionId: null,
    attempts: [],
    unsupported: [],
  };

  // Step 1: a bare connection with the simplest possible config.
  console.log('Step 1. Bare connection.');
  const bare = await probe('bare', { ...BASE });
  result.attempts.push({ step: 'bare', config: { ...BASE }, ...strip(bare) });

  if (!bare.ok) {
    kv('bare connect', `FAILED: ${bare.error}`);
    console.log('');
    console.log('  If this says 401 or 403, the key is wrong or has no credit.');
    console.log('  If it says 4xx with a parameter name, the API has changed shape.');
    save('00-connect', result);
    return verdict(false, 'Cannot open a streaming session at all. Nothing else can run.');
  }

  kv('bare connect', 'ok');
  result.connected = true;
  result.sessionId = bare.begin?.id ?? null;
  if (bare.begin?.expires_at) kv('session expires_at', bare.begin.expires_at);

  // Step 2: which speech model identifier is accepted?
  console.log('');
  console.log('Step 2. Speech model identifier.');
  for (const model of MODEL_CANDIDATES) {
    const config = { ...BASE, ...(model ? { speech_model: model } : {}) };
    const r = await probe(`model:${model ?? 'default'}`, config);
    result.attempts.push({ step: 'model', model: model ?? null, ...strip(r) });
    kv(`speech_model=${model ?? '(omitted)'}`, r.ok ? 'accepted' : `rejected: ${short(r.error)}`);
    if (r.ok) { result.model = model ?? null; break; }
    await sleep(2500);
  }

  // Step 3: which short-silence parameter spelling is accepted, and does a long
  // value survive? This is the parameter the whole product depends on.
  console.log('');
  console.log('Step 3. Turn detection parameter names.');
  for (const key of MIN_SILENCE_KEYS) {
    const config = {
      ...BASE,
      ...(result.model ? { speech_model: result.model } : {}),
      [key]: 6000,
      max_turn_silence: 9000,
    };
    const r = await probe(`silence:${key}`, config);
    result.attempts.push({ step: 'minSilenceKey', key, ...strip(r) });
    kv(`${key}=6000`, r.ok ? 'accepted' : `rejected: ${short(r.error)}`);
    if (r.ok) { result.minSilenceKey = key; break; }
    await sleep(2500);
  }

  // Step 4: the other parameters One Moment relies on, probed one at a time so a
  // single unsupported option does not invalidate the whole configuration.
  console.log('');
  console.log('Step 4. Individual parameters used by the design.');
  const optional = {
    end_of_turn_confidence_threshold: 0.85,
    vad_threshold: 0.12,
    format_turns: true,
    speaker_labels: true,
    language_detection: true,
    keyterms_prompt: ['amlodipine', 'metformin'],
    mode: 'max_accuracy',
    min_turn_silence: 6000,
  };

  // MEASURED 17 Sept: concurrency is NOT the constraint. Four sessions were held
  // open simultaneously with no error. The constraint is release lag: a
  // terminated session lingers on the account's count for tens of seconds, so
  // opening and closing in rapid succession accumulates phantom sessions and
  // produces a misleading "Too many concurrent sessions" error.
  //
  // So probe in parallel batches and cool down between them, rather than
  // sequentially with short gaps. Fewer windows, no churn.
  const BATCH = 4;
  const entries = Object.entries(optional);

  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);

    const results = await Promise.all(batch.map(([key, value]) =>
      probe(`opt:${key}`, {
        ...BASE,
        ...(result.model ? { speech_model: result.model } : {}),
        [key]: value,
      })
    ));

    batch.forEach(([key, value], j) => {
      const r = results[j];
      result.attempts.push({ step: 'optional', key, value, ...strip(r) });
      kv(key, r.ok ? 'accepted' : `rejected: ${short(r.error)}`);
      if (!r.ok) result.unsupported.push(key);
    });

    if (i + BATCH < entries.length) {
      console.log('  (cooling down 45s so sessions release)');
      await sleep(45000);
    }
  }

  save('00-connect', result);

  console.log('');
  kv('model to use', result.model ?? '(server default)');
  kv('short-silence parameter', result.minSilenceKey ?? 'NONE ACCEPTED');
  kv('unsupported parameters', result.unsupported.length ? result.unsupported.join(', ') : 'none');

  const pass = result.connected && !!result.minSilenceKey;
  return verdict(
    pass,
    pass
      ? 'Streaming works and the patience parameter is settable. Continue to test 01.'
      : 'Connected, but no long-silence parameter was accepted. The design needs revising.'
  );
}

const strip = (r) => (r.ok ? { ok: true } : { ok: false, error: r.error });
const short = (e) => String(e).replace(/\s+/g, ' ').slice(0, 90);

main()
  .then((pass) => process.exit(pass ? 0 : 1))
  .catch((err) => { console.error(err); process.exit(1); });
