// FLUENTBENCH phase 2: what the engine would do for a fluent speaker.
//
// The question this answers is the fair objection to the whole product: a relay
// tuned to wait six seconds and to ask whenever it is unsure might be unusable
// for someone with no speech disorder. If that were true, the design would be
// wrong, not just narrow.
//
// Scored by the same eval/score.mjs as every other benchmark, against the
// sentence LibriSpeech says was read.
//
//   node --env-file=.env eval/fluentbench-decide.mjs [--rescore]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleEvidence, runDissent } from '@one-moment/core';
import { claim, findInventedWords, isInverted, materiallyWrong, wer } from './score.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(here, 'results', 'fluentbench-decisions.json');
const key = process.env.ASSEMBLYAI_API_KEY;
const rescore = process.argv.includes('--rescore');
if (!key && !rescore) throw new Error('ASSEMBLYAI_API_KEY is not set');
const MODEL = process.env.LLM_GATEWAY_MODEL || undefined;

const evidence = JSON.parse(fs.readFileSync(path.join(here, 'results', 'fluentbench-evidence.json'), 'utf8'));
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

const joined = (turns) => ({
  type: 'Turn', turn_order: turns[0]?.turn_order ?? 0, end_of_turn: true,
  transcript: turns.map((t) => t.transcript).join(' ').replace(/\s+/g, ' ').trim(),
  words: turns.flatMap((t) => t.words ?? []),
});

const rows = [];
let i = 0;
for (const r of evidence.rows) {
  i++;
  const patient = joined(r.patient);
  const fastText = joined(r.fast).transcript;
  let decision = cache[r.id];
  if (!decision && !rescore) {
    if (!patient.transcript) {
      decision = { action: 'hold', rule: 7, text: null, models: 0 };
    } else {
      const ev = assembleEvidence({ patient, fastFinals: r.fast.map((t) => ({ type: 'Turn', end_of_turn: true, ...t })) });
      const res = await runDissent(ev, { apiKey: key, ...(MODEL ? { model: MODEL } : {}), mode: 'serial', live: false, maxRetries: 6, callerName: 'The caller', lexicon: [] });
      decision = {
        action: res.decision.action,
        rule: res.decision.policyRule,
        reason: res.decision.reason,
        text: res.decision.action === 'relay' ? res.decision.text : null,
        models: (res.timings.advocateMs !== null ? 1 : 0) + (res.timings.skepticMs !== null ? 1 : 0),
      };
    }
    cache[r.id] = decision;
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
  }
  if (!decision) continue;

  const score = (said) => said
    ? { relayed: said, invented: findInventedWords(claim(said), r.prompt), inverted: isInverted(claim(said), r.prompt), wer: wer(claim(said), r.prompt), wrong: materiallyWrong(claim(said), r.prompt) }
    : { relayed: null, invented: [], inverted: false, wer: null, wrong: false };

  rows.push({
    id: r.id, speaker: r.speaker, prompt: r.prompt, audioMs: r.audioMs, waitedMs: r.waitedMs, endedBy: r.endedBy,
    patientTurns: r.patient.length, fastTurns: r.fast.length,
    heard: { patient: patient.transcript, fast: fastText },
    wer: { patient: wer(patient.transcript, r.prompt), fast: wer(fastText, r.prompt) },
    oneMoment: { ...score(decision.text), action: decision.action, rule: decision.rule, models: decision.models ?? 0 },
  });
  console.log(`${String(i).padStart(3)} ${r.id.padEnd(22)} ${decision.action.padEnd(5)} rule ${String(decision.rule).padStart(2)}  waited ${String(r.waitedMs).padStart(5)}ms`);
}

// ---- summary ---------------------------------------------------------------------
const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
const spoke = rows.filter((x) => x.oneMoment.relayed);
const asked = rows.filter((x) => !x.oneMoment.relayed);
const summary = {
  sentences: rows.length,
  speakers: [...new Set(rows.map((x) => x.speaker))].length,
  relayed: spoke.length,
  asked: asked.length,
  wrong: spoke.filter((x) => x.oneMoment.wrong).length,
  invented: spoke.filter((x) => x.oneMoment.invented.length).length,
  flipped: spoke.filter((x) => x.oneMoment.inverted).length,
  verbatim: rows.filter((x) => x.oneMoment.rule === 9).length,
  modelCalls: rows.reduce((s, x) => s + x.oneMoment.models, 0),
  turns: {
    patientSplit: rows.filter((x) => x.patientTurns > 1).length,
    fastSplit: rows.filter((x) => x.fastTurns > 1).length,
    endedEarly: rows.filter((x) => x.endedBy === 'early').length,
    endedNatural: rows.filter((x) => x.endedBy === 'natural').length,
    endedCap: rows.filter((x) => x.endedBy === 'cap').length,
  },
  // What a fluent speaker would actually feel: how long after they stopped did
  // the turn end.
  waited: {
    meanMs: Math.round(mean(rows.map((x) => x.waitedMs)) ?? 0),
    medianMs: (() => { const s = rows.map((x) => x.waitedMs).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; })(),
    underTwoSeconds: rows.filter((x) => x.waitedMs < 2000).length,
  },
  wer: { patient: mean(rows.map((x) => x.wer.patient)), fast: mean(rows.map((x) => x.wer.fast)) },
  byRule: Object.fromEntries([...new Set(rows.map((x) => x.oneMoment.rule))].sort((a, b) => a - b).map((n) => [n, rows.filter((x) => x.oneMoment.rule === n).length])),
};

const result = { ranAt: new Date().toISOString(), corpus: 'LibriSpeech test-clean', model: MODEL ?? 'discovered', summary, rows };
fs.writeFileSync(path.join(here, 'results', `fluentbench-${result.ranAt.slice(0, 10)}.json`), JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(here, '..', 'apps', 'web', 'src', 'content', 'fluentbench.json'), JSON.stringify(result, null, 1));
console.log(JSON.stringify(summary, null, 1));
