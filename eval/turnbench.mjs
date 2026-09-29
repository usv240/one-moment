// TURNBENCH: what the turn-detection setting costs the person speaking.
//
// It is possible to characterise AssemblyAI's endpointing by sweeping its
// parameters against synthetic speech, and that tells you when a turn fires.
// It does not tell you what firing then costs, because a synthetic voice never
// stops mid-word to look for one.
//
// So this sweeps min_turn_silence across the same real disordered speech the
// rest of this project is measured on (TORGO), and scores each setting by the
// thing that actually matters to the caller:
//
//   splits        how often the sentence was cut into more than one turn
//   lostWords     how many words of the sentence were still to come when the
//                 first turn closed, which is what an agent would have talked over
//   waitedMs      how long after the speaker stopped the turn finally ended,
//                 which is what a caller feels as lag
//
// Two numbers in tension, measured on the same audio, at each setting. The
// question is not "when does it fire" but "what does firing take away".
//
//   node --env-file=.env eval/turnbench.mjs [--n 12] [--seed 7]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeTokens } from '@one-moment/core';
import { RealtimeStream } from '../apps/orchestrator/src/realtime.ts';
import { seededRng } from './spike/lib/degrade.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const N = Number(argv.n ?? 12);
const SEED = Number(argv.seed ?? 7);
const CORPUS = path.join(here, 'data', 'torgo');
const OUT = path.join(here, 'results', 'turnbench-evidence.json');
const key = process.env.ASSEMBLYAI_API_KEY;
if (!key) throw new Error('ASSEMBLYAI_API_KEY is not set');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The settings a builder actually chooses between: the vendor default (send no
// value at all), a common "be a bit patient" value, and ours.
const SETTINGS = [
  { label: 'vendor default', min_turn_silence: null },
  { label: '1000ms', min_turn_silence: 1000 },
  { label: '2400ms', min_turn_silence: 2400 },
  { label: '6000ms (ours)', min_turn_silence: 6000 },
];

const earConfig = (min) => ({
  encoding: 'pcm_s16le',
  sample_rate: 16000,
  speech_model: 'universal-3-5-pro',
  mode: 'max_accuracy',
  ...(min === null ? {} : { min_turn_silence: min, max_turn_silence: Math.max(9000, min + 3000) }),
  vad_threshold: 0.12,
});

function sentenceOf(raw) {
  const t = raw.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || /^\[/.test(raw.trim()) || /input\/|\.jpg|\.png|xxx/i.test(raw)) return null;
  return normalizeTokens(t).length >= 6 ? t : null;
}

function select() {
  const cands = [];
  for (const sp of fs.readdirSync(CORPUS).filter((d) => /^[FM]\d\d$/.test(d)).sort()) {
    for (const ses of fs.readdirSync(path.join(CORPUS, sp)).filter((d) => /^Session/.test(d)).sort()) {
      const dir = path.join(CORPUS, sp, ses);
      if (!fs.existsSync(path.join(dir, 'prompts'))) continue;
      for (const f of fs.readdirSync(path.join(dir, 'prompts')).sort()) {
        const prompt = sentenceOf(fs.readFileSync(path.join(dir, 'prompts', f), 'utf8'));
        if (!prompt) continue;
        const id = f.replace(/\.txt$/, '');
        const head = path.join(dir, 'wav_headMic', `${id}.wav`);
        if (!fs.existsSync(head)) continue;
        cands.push({ id: `${sp}/${ses}/${id}`, speaker: sp, prompt, wav: head });
      }
    }
  }
  const rng = seededRng(SEED);
  const shuffled = cands.map((c) => [rng(), c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  const perSpeaker = {};
  const picked = [];
  const seen = new Set();
  for (const c of shuffled) {
    const k = normalizeTokens(c.prompt).join(' ');
    if (seen.has(k)) continue;
    perSpeaker[c.speaker] = (perSpeaker[c.speaker] ?? 0) + 1;
    if (perSpeaker[c.speaker] > 2) continue;
    seen.add(k);
    picked.push(c);
    if (picked.length >= N) break;
  }
  return picked;
}

const FRAME = 1600;
const pcmOf = (wav) => execFileSync('ffmpeg', ['-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });

async function openEar(config) {
  for (let attempt = 1; ; attempt++) {
    const ear = new RealtimeStream('probe', key, config);
    ear.on('error', () => {});
    try {
      await ear.open();
      return ear;
    } catch (err) {
      await ear.close(500).catch(() => {});
      if (attempt >= 6) throw err;
      console.log(`  ear busy, waiting 60s for the account to clear`);
      await sleep(60000);
    }
  }
}

/**
 * One sentence at one setting. No ForceEndpoint and no second ear: this measures
 * what the setting alone does, so the number is about AssemblyAI rather than
 * about our orchestration on top of it.
 */
async function probe(ear, u) {
  const pcm = pcmOf(u.wav);
  const turns = [];
  const onTurn = (t) => { if (t.end_of_turn && (t.transcript || t.words?.length)) turns.push({ transcript: t.transcript, at: Date.now() }); };
  ear.on('turn', onTurn);

  const t0 = Date.now();
  let tick = 0;
  const pace = async () => { tick++; const w = t0 + tick * 50 - Date.now(); if (w > 0) await sleep(w); };
  for (let i = 0; i < pcm.length; i += FRAME) {
    const f = pcm.subarray(i, i + FRAME);
    ear.send(f.length === FRAME ? f : Buffer.concat([f, Buffer.alloc(FRAME - f.length)]));
    await pace();
  }
  const speechEnded = Date.now();
  // Silence until the setting decides the turn is over, capped generously.
  const firstTurnAt = () => (turns.length ? turns[0].at : null);
  while (Date.now() - speechEnded < 13000) {
    ear.send(Buffer.alloc(FRAME));
    await pace();
    if (turns.length && Date.now() - speechEnded > 1200) break;
  }
  ear.forceEndpoint();
  const from = Date.now();
  while (Date.now() - from < 2500) { ear.send(Buffer.alloc(FRAME)); await pace(); }
  ear.off('turn', onTurn);

  const first = turns[0]?.transcript ?? '';
  const all = turns.map((t) => t.transcript).join(' ');
  const said = normalizeTokens(u.prompt).length;
  const inFirst = normalizeTokens(first).length;
  return {
    splits: turns.length,
    // Words of the sentence still to come when the first turn closed: what an
    // ordinary agent would have started talking over.
    lostWords: Math.max(0, said - inFirst),
    saidWords: said,
    waitedMs: firstTurnAt() ? firstTurnAt() - speechEnded : null,
    first,
    all,
  };
}

const items = select();
const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { corpus: 'TORGO', rows: [] };
const key2 = (id, label) => `${id}::${label}`;
const have = new Set(done.rows.map((r) => key2(r.id, r.setting)));
console.log(`${items.length} sentences x ${SETTINGS.length} settings = ${items.length * SETTINGS.length} probes`);

for (const s of SETTINGS) {
  const todo = items.filter((u) => !have.has(key2(u.id, s.label)));
  if (!todo.length) continue;
  const ear = await openEar(earConfig(s.min_turn_silence));
  console.log(`\n== ${s.label}`);
  try {
    for (const u of todo) {
      const r = await probe(ear, u);
      done.rows.push({ id: u.id, speaker: u.speaker, prompt: u.prompt, setting: s.label, minTurnSilence: s.min_turn_silence, ...r });
      fs.writeFileSync(OUT, JSON.stringify({ ...done, seed: SEED, settings: SETTINGS, updatedAt: new Date().toISOString() }, null, 1));
      console.log(`  ${u.id.padEnd(20)} turns ${r.splits}  lost ${String(r.lostWords).padStart(2)}/${r.saidWords}  waited ${String(r.waitedMs ?? -1).padStart(5)}ms`);
    }
  } finally {
    await ear.close().catch(() => {});
  }
  await sleep(3000);
}
console.log('\ndone');
