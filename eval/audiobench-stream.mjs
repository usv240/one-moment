// AUDIOBENCH, phase 1: real disordered speech through both ears.
//
// TORGO (Rudzicz, Namasivayam and Wolff, 2012): read speech from speakers with
// dysarthria, with the prompt each speaker read. Free for academic, non-profit
// use; we do not redistribute any audio, and we cite the paper wherever a
// number from it appears.
//
// Every sentence is streamed in real time through the patient ear and the fast
// ear, exactly as in a live call, and each turn ends exactly as in production:
// early (ForceEndpoint) when both ears agree the sentence is finished after
// 1.5s of silence, otherwise at the patient ear's own end of turn, capped at 9.5s.
// Both ears stay open for a whole speaker, like one long call, because opening
// and closing sessions quickly is what produced "Too many concurrent sessions".
//
// Output: eval/results/audiobench-evidence.json (resumable). Phase 2 is
// audiobench-decide.mjs, which needs no audio.
//
//   node --env-file=.env eval/audiobench-stream.mjs [--per-speaker 15] [--seed 7]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fastConfig, normalizeTokens, patientConfig, soundsFinished, EARLY_END_SILENCE_MS } from '@one-moment/core';
import { RealtimeStream } from '../apps/orchestrator/src/realtime.ts';
import { seededRng } from './spike/lib/degrade.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const CORPUS = argv.corpus ?? path.join(here, 'data', 'torgo');
const PER_SPEAKER = Number(argv['per-speaker'] ?? 15);
const SEED = Number(argv.seed ?? 7);
const OUT = argv.out ? path.resolve(argv.out) : path.join(here, 'results', 'audiobench-evidence.json');
const key = process.env.ASSEMBLYAI_API_KEY;
if (!key) throw new Error('ASSEMBLYAI_API_KEY is not set');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- selection ---------------------------------------------------------------
/** A read sentence: bracketed stage directions removed, at least four words. */
function sentenceOf(raw) {
  const t = raw.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || /^\[/.test(raw.trim()) || /input\/|\.jpg|\.png|xxx/i.test(raw)) return null;
  return normalizeTokens(t).length >= 4 ? t : null;
}

function select() {
  const speakers = fs.readdirSync(CORPUS).filter((d) => /^[FM]\d\d$/.test(d)).sort();
  const only = argv.speakers ? new Set(argv.speakers.split(',')) : null;
  if (only) speakers.splice(0, speakers.length, ...speakers.filter((sp) => only.has(sp)));
  const picked = [];
  for (const sp of speakers) {
    const cands = [];
    for (const ses of fs.readdirSync(path.join(CORPUS, sp)).filter((d) => /^Session/.test(d)).sort()) {
      const dir = path.join(CORPUS, sp, ses);
      if (!fs.existsSync(path.join(dir, 'prompts'))) continue;
      for (const f of fs.readdirSync(path.join(dir, 'prompts')).sort()) {
        const prompt = sentenceOf(fs.readFileSync(path.join(dir, 'prompts', f), 'utf8'));
        if (!prompt) continue;
        const id = f.replace(/\.txt$/, '');
        const head = path.join(dir, 'wav_headMic', `${id}.wav`);
        const array = path.join(dir, 'wav_arrayMic', `${id}.wav`);
        const wav = fs.existsSync(head) ? head : fs.existsSync(array) ? array : null;
        if (!wav) continue;
        cands.push({ id: `${sp}/${ses}/${id}`, speaker: sp, prompt, wav, mic: wav === head ? 'head' : 'array' });
      }
    }
    // Distinct sentences per speaker, in a seeded random order.
    const rng = seededRng(SEED + sp.charCodeAt(0) * 100 + Number(sp.slice(1)));
    const seen = new Set();
    const shuffled = cands.map((c) => [rng(), c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    const mine = [];
    for (const c of shuffled) {
      const k = normalizeTokens(c.prompt).join(' ');
      if (seen.has(k)) continue;
      seen.add(k);
      mine.push(c);
      if (mine.length >= PER_SPEAKER) break;
    }
    console.log(`${sp}: ${cands.length} sentence recordings, using ${mine.length}`);
    picked.push(...mine);
  }
  return picked;
}

// ---- streaming ---------------------------------------------------------------
const FRAME = 1600; // 50ms at 16kHz PCM16
const pcmOf = (wav) => execFileSync('ffmpeg', ['-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });

async function openEars() {
  for (let attempt = 1; ; attempt++) {
    const patient = new RealtimeStream('patient', key, patientConfig());
    const fast = new RealtimeStream('fast', key, fastConfig());
    try {
      await Promise.all([patient.open(), fast.open()]);
      return { patient, fast };
    } catch (err) {
      await Promise.all([patient.close(500), fast.close(500)]).catch(() => {});
      if (attempt >= 4) throw err;
      console.log(`  open failed (${err.message}); waiting 45s, the account's lingering sessions need to clear`);
      await sleep(45000);
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
  const frame = (buf) => { ears.patient.send(buf); ears.fast.send(buf); };
  const pace = async () => { tick++; const due = t0 + tick * 50; const w = due - Date.now(); if (w > 0) await sleep(w); };
  for (let i = 0; i < pcm.length; i += FRAME) {
    const f = pcm.subarray(i, i + FRAME);
    frame(f.length === FRAME ? f : Buffer.concat([f, Buffer.alloc(FRAME - f.length)]));
    await pace();
  }
  // After the audio: silence, and the production end-of-turn rules.
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
  ears.patient.forceEndpoint();
  ears.fast.forceEndpoint();
  const waitFrom = Date.now();
  while (Date.now() - waitFrom < 3000 && !(patientDone())) { frame(silence); await pace(); }
  // A second of silence between sentences, so one never bleeds into the next.
  for (let i = 0; i < 20; i++) { frame(silence); await pace(); }
  ears.patient.off('turn', onP);
  ears.fast.off('turn', onF);
  return {
    ...u,
    audioMs,
    endedBy: capped ? 'cap' : forced ? 'early' : 'natural',
    patient: got.patient.map(({ transcript, words, turn_order }) => ({ transcript, words, turn_order })),
    fast: got.fast.map(({ transcript, words, turn_order }) => ({ transcript, words, turn_order })),
  };
}

const items = select();
const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { corpus: 'TORGO', rows: [] };
const have = new Set(done.rows.map((r) => r.id));
const todo = items.filter((u) => !have.has(u.id));
console.log(`${items.length} sentences selected, ${todo.length} still to stream`);

const bySpeaker = Object.groupBy(todo, (u) => u.speaker);
for (const [sp, list] of Object.entries(bySpeaker)) {
  const ears = await openEars();
  console.log(`${sp}: ears open`);
  for (const u of list) {
    const r = await runUtterance(ears, u);
    done.rows.push({ ...r, wav: path.relative(CORPUS, r.wav) });
    fs.writeFileSync(OUT, JSON.stringify({ ...done, seed: SEED, perSpeaker: PER_SPEAKER, updatedAt: new Date().toISOString() }, null, 1));
    console.log(`  ${u.id.padEnd(22)} ${String(r.fast.length).padStart(2)} fast / ${r.patient.length} patient turns, ${r.endedBy.padEnd(7)} | ${u.prompt.slice(0, 50)}\n${' '.repeat(26)}patient: ${r.patient.map((t) => t.transcript).join(' / ').slice(0, 90)}`);
  }
  await Promise.all([ears.patient.close(), ears.fast.close()]);
}
console.log('done');
