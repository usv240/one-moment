// FLUENTBENCH: does a system tuned for patience get in the way of everyone else?
//
// Every other number this project publishes is about disordered speech, where
// waiting longer is obviously right. The fair objection is the opposite one: a
// relay that waits six seconds and asks when unsure could be unusable for a
// fluent speaker, and nothing we had measured could answer that.
//
// So: ordinary, fluent, clean human speech, from a corpus we did not record.
// LibriSpeech test-clean (Panayotov et al. 2015, CC BY 4.0), read by speakers
// with no speech disorder, with the sentence each one read as ground truth.
// Same two ears, same end-of-turn rules, same engine, same scorer.
//
// What must be true for the design to be defensible:
//   - it relays almost everything, rather than asking constantly
//   - it puts no words in a fluent speaker's mouth either
//   - the patient ear does not sit there waiting after someone has finished
//
//   node --env-file=.env eval/fluentbench.mjs [--n 60] [--seed 7]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fastConfig, normalizeTokens, patientConfig, soundsFinished, EARLY_END_SILENCE_MS } from '@one-moment/core';
import { RealtimeStream } from '../apps/orchestrator/src/realtime.ts';
import { seededRng } from './spike/lib/degrade.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const N = Number(argv.n ?? 60);
const SEED = Number(argv.seed ?? 7);
const ROOT = path.join(here, 'data', 'LibriSpeech', 'test-clean');
const OUT = path.join(here, 'results', 'fluentbench-evidence.json');
const key = process.env.ASSEMBLYAI_API_KEY;
if (!key) throw new Error('ASSEMBLYAI_API_KEY is not set');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- selection ----------------------------------------------------------------
function select() {
  const items = [];
  for (const spk of fs.readdirSync(ROOT)) {
    for (const ch of fs.readdirSync(path.join(ROOT, spk))) {
      const dir = path.join(ROOT, spk, ch);
      const trans = fs.readdirSync(dir).find((f) => f.endsWith('.trans.txt'));
      if (!trans) continue;
      for (const line of fs.readFileSync(path.join(dir, trans), 'utf8').split('\n')) {
        const m = line.trim().match(/^(\S+)\s+(.+)$/);
        if (!m) continue;
        const wav = path.join(dir, `${m[1]}.flac`);
        // Sentence-length utterances only, so the comparison is like for like
        // with the disordered-speech run.
        const words = normalizeTokens(m[2]).length;
        if (words >= 6 && words <= 20 && fs.existsSync(wav)) items.push({ id: m[1], speaker: spk, prompt: m[2], wav });
      }
    }
  }
  const rng = seededRng(SEED);
  const shuffled = items.map((x) => [rng(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
  // At most two per speaker, so no one voice dominates the result.
  const perSpeaker = {};
  const picked = [];
  for (const x of shuffled) {
    perSpeaker[x.speaker] = (perSpeaker[x.speaker] ?? 0) + 1;
    if (perSpeaker[x.speaker] > 2) continue;
    picked.push(x);
    if (picked.length >= N) break;
  }
  return picked;
}

const FRAME = 1600;
const pcmOf = (wav) => execFileSync('ffmpeg', ['-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });

// ---- streaming ------------------------------------------------------------------
// Identical to the disordered-speech run: both ears open for a whole speaker,
// real time, production end-of-turn rules.
async function openEars() {
  for (let attempt = 1; ; attempt++) {
    const patient = new RealtimeStream('patient', key, patientConfig());
    const fast = new RealtimeStream('fast', key, fastConfig());
    // Sessions linger after Terminate, so a run started soon after another can
    // be refused. Listen for the error rather than letting it go unhandled, and
    // wait for the account's previous sessions to clear.
    patient.on('error', () => {});
    fast.on('error', () => {});
    try {
      await Promise.all([patient.open(), fast.open()]);
      return { patient, fast };
    } catch (err) {
      await Promise.all([patient.close(500), fast.close(500)]).catch(() => {});
      if (attempt >= 6) throw err;
      console.log(`  ears busy (${err.message || err.context || 'unknown'}); waiting 60s for the account to clear`);
      await sleep(60000);
    }
  }
}

async function runUtterance(ears, u) {
  const pcm = pcmOf(u.wav);
  const got = { patient: [], fast: [] };
  let patientPartial = null;
  const onP = (t) => { if (t.end_of_turn) { if (t.transcript || t.words?.length) got.patient.push(t); patientPartial = null; } else patientPartial = t; };
  const onF = (t) => { if (t.end_of_turn && (t.transcript || t.words?.length)) got.fast.push(t); };
  ears.patient.on('turn', onP);
  ears.fast.on('turn', onF);

  const t0 = Date.now();
  let tick = 0;
  const frame = (b) => { ears.patient.send(b); ears.fast.send(b); };
  const pace = async () => { tick++; const w = t0 + tick * 50 - Date.now(); if (w > 0) await sleep(w); };
  for (let i = 0; i < pcm.length; i += FRAME) {
    const f = pcm.subarray(i, i + FRAME);
    frame(f.length === FRAME ? f : Buffer.concat([f, Buffer.alloc(FRAME - f.length)]));
    await pace();
  }
  const audioMs = Date.now() - t0;
  const silence = Buffer.alloc(FRAME);
  let forced = false;
  const endedAt = Date.now();
  const patientDone = () => got.patient.length > 0 && patientPartial === null;
  while (Date.now() - endedAt < 9500) {
    frame(silence);
    await pace();
    if (patientDone() && Date.now() - endedAt > 1500) break;
    const p = patientPartial;
    const f = got.fast.at(-1);
    const tail = (s) => normalizeTokens(s).slice(-2).join(' ');
    if (!forced && p && f && Date.now() - endedAt >= EARLY_END_SILENCE_MS && soundsFinished(p.transcript) && soundsFinished(f.transcript) && tail(p.transcript) === tail(f.transcript)) {
      forced = true;
      ears.patient.forceEndpoint();
    }
  }
  const capped = !patientDone();
  // How long after the speaker stopped did the turn actually end? This is the
  // number a fluent speaker would feel as lag.
  const waitedMs = Date.now() - endedAt;
  ears.patient.forceEndpoint();
  ears.fast.forceEndpoint();
  const from = Date.now();
  while (Date.now() - from < 3000 && !patientDone()) { frame(silence); await pace(); }
  for (let i = 0; i < 20; i++) { frame(silence); await pace(); }
  ears.patient.off('turn', onP);
  ears.fast.off('turn', onF);
  return {
    ...u,
    audioMs,
    waitedMs,
    endedBy: capped ? 'cap' : forced ? 'early' : 'natural',
    patient: got.patient.map(({ transcript, words, turn_order }) => ({ transcript, words, turn_order })),
    fast: got.fast.map(({ transcript, words, turn_order }) => ({ transcript, words, turn_order })),
  };
}

const items = select();
const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { corpus: 'LibriSpeech test-clean', rows: [] };
const have = new Set(done.rows.map((r) => r.id));
const todo = items.filter((u) => !have.has(u.id));
console.log(`${items.length} fluent sentences selected, ${todo.length} still to stream`);

// One pair of ears for the whole run. Closing and reopening per speaker is what
// produced "Too many concurrent sessions": sessions linger after Terminate, so
// churning them is the one thing to avoid.
const ears = await openEars();
try {
  for (const u of todo) {
    const r = await runUtterance(ears, u);
    done.rows.push({ ...r, wav: path.relative(ROOT, r.wav) });
    fs.writeFileSync(OUT, JSON.stringify({ ...done, seed: SEED, updatedAt: new Date().toISOString() }, null, 1));
    console.log(`  ${u.id.padEnd(22)} ${r.patient.length}p/${r.fast.length}f ${String(r.waitedMs).padStart(5)}ms ${r.endedBy.padEnd(7)} | ${r.patient.map((t) => t.transcript).join(' ').slice(0, 60)}`);
  }
} finally {
  await Promise.all([ears.patient.close(), ears.fast.close()]).catch(() => {});
}
console.log('done');
