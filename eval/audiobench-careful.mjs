// AUDIOBENCH, phase 1b: the self-audit's careful transcript of every sentence.
//
// The self-audit grades each call against AssemblyAI's pre-recorded model. That
// is only worth anything if the careful model hears disordered speech better
// than the live ears, and if it would flag the relays that were wrong. This
// transcribes every streamed TORGO sentence with the same call the product's
// self-audit makes (apps/orchestrator/src/audit.ts), five at a time, resumable.
//
//   node --env-file=.env eval/audiobench-careful.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { transcribeCarefully } from '../apps/orchestrator/src/audit.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'results');
const CORPUS = path.join(here, 'data', 'torgo');
const OUT = path.join(dir, 'audiobench-careful.json');
const key = process.env.ASSEMBLYAI_API_KEY;
if (!key) throw new Error('ASSEMBLYAI_API_KEY is not set');

const rows = fs.readdirSync(dir).filter((f) => /^audiobench-evidence.*\.json$/.test(f))
  .flatMap((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).rows; } catch { return []; } });
const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const todo = rows.filter((r) => !done[r.id]);
console.log(`${rows.length} streamed sentences, ${todo.length} to transcribe carefully`);

const pcmOf = (wav) => execFileSync('ffmpeg', ['-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
let next = 0;
async function worker() {
  while (next < todo.length) {
    const r = todo[next++];
    try {
      const c = await transcribeCarefully(key, pcmOf(path.join(CORPUS, r.wav)));
      done[r.id] = { text: c.text, model: c.model, words: c.words.map((w) => ({ text: w.text, start: w.start, end: w.end, confidence: w.confidence })) };
      fs.writeFileSync(OUT, JSON.stringify(done, null, 1));
      console.log(`  ${r.id.padEnd(22)} ${c.text.slice(0, 80)}`);
    } catch (err) {
      console.log(`  ${r.id.padEnd(22)} failed: ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 5 }, worker));
console.log('done');
