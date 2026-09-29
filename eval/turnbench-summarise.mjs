// Turn the sweep into the two numbers that are in tension, per setting.
//
// The point of the table is that it cannot be read as "higher is better". Every
// row buys patience with lag, and the honest question is what each setting takes
// away from the person speaking.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = JSON.parse(fs.readFileSync(path.join(here, 'results', 'turnbench-evidence.json'), 'utf8'));
const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

const labels = [...new Set(ev.rows.map((r) => r.setting))];
const settings = labels.map((label) => {
  const rows = ev.rows.filter((r) => r.setting === label);
  const waits = rows.map((r) => r.waitedMs).filter((x) => x !== null);
  return {
    label,
    minTurnSilence: rows[0]?.minTurnSilence ?? null,
    sentences: rows.length,
    // Cut into more than one turn: the agent would have started talking mid-sentence.
    split: rows.filter((r) => r.splits > 1).length,
    // Turns that closed while the person was still speaking.
    firedDuringSpeech: rows.filter((r) => r.waitedMs !== null && r.waitedMs < 0).length,
    // Words of the sentence still to come when the first turn closed.
    lostWordsTotal: rows.reduce((s, r) => s + r.lostWords, 0),
    saidWordsTotal: rows.reduce((s, r) => s + r.saidWords, 0),
    sentencesLosingWords: rows.filter((r) => r.lostWords > 0).length,
    waitedMedianMs: median(waits),
    waitedMeanMs: waits.length ? Math.round(mean(waits)) : null,
  };
});

const result = {
  ranAt: new Date().toISOString(),
  corpus: 'TORGO, head microphone',
  note: 'One ear, no ForceEndpoint and no second stream, so each number is about the setting rather than about our orchestration on top of it.',
  sentences: new Set(ev.rows.map((r) => r.id)).size,
  speakers: new Set(ev.rows.map((r) => r.speaker)).size,
  settings,
};
fs.writeFileSync(path.join(here, 'results', `turnbench-${result.ranAt.slice(0, 10)}.json`), JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(here, '..', 'apps', 'web', 'src', 'content', 'turnbench.json'), JSON.stringify(result, null, 1));

console.log(`${result.sentences} sentences, ${result.speakers} speakers\n`);
console.log('setting          split  fired-early  words lost  median wait');
for (const s of settings) {
  console.log(`${s.label.padEnd(16)} ${String(s.split).padStart(2)}/${s.sentences}   ${String(s.firedDuringSpeech).padStart(2)}        ${String(s.lostWordsTotal).padStart(3)}/${s.saidWordsTotal}     ${String(s.waitedMedianMs).padStart(6)}ms`);
}
