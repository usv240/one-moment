// AUDIOBENCH, phase 2: what each system would have said for the caller.
//
// Reads the evidence phase 1 streamed from real dysarthric speech (TORGO) and
// compares three arms on every sentence, scored against the prompt the speaker
// read (eval/score.mjs, the same scorer as NEGBENCH):
//
//   ordinary   an ordinary voice agent: relays what the default-settings ear heard
//   patient    the patient ear's transcript, relayed with no checks
//   one-moment the product's own engine (packages/core runDissent), as a live call runs it
//
// A relay is "materially wrong" if it contains a content word the speaker never
// said, or flips the meaning. For One Moment's questions: a question was needed
// if the ordinary relay would have been materially wrong.
//
// Model calls are cached per sentence, so re-running only scores.
//   node --env-file=.env eval/audiobench-decide.mjs [--rescore]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleEvidence, runDissent } from '@one-moment/core';
import { claim, findInventedWords, isInverted, materiallyWrong, wer } from './score.mjs';
import { grade } from '../apps/orchestrator/src/audit.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(here, 'results', 'audiobench-decisions.json');
const key = process.env.ASSEMBLYAI_API_KEY;
const rescore = process.argv.includes('--rescore');
if (!key && !rescore) throw new Error('ASSEMBLYAI_API_KEY is not set');
const MODEL = process.env.LLM_GATEWAY_MODEL || undefined;

// Every evidence file phase 1 wrote (speakers can be streamed in parallel), merged.
const files = fs.readdirSync(path.join(here, 'results')).filter((f) => /^audiobench-evidence.*\.json$/.test(f));
const seenIds = new Set();
const evidence = { rows: files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(here, 'results', f), 'utf8')).rows).filter((r) => !seenIds.has(r.id) && seenIds.add(r.id)) };
evidence.rows.sort((a, b) => a.id.localeCompare(b.id));
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
// The self-audit's careful transcripts (audiobench-careful.mjs), if present.
const CAREFUL = path.join(here, 'results', 'audiobench-careful.json');
const careful = fs.existsSync(CAREFUL) ? JSON.parse(fs.readFileSync(CAREFUL, 'utf8')) : {};

/** All of a stream's final turns for one sentence, as one turn. */
function joined(turns) {
  return {
    type: 'Turn', turn_order: turns[0]?.turn_order ?? 0, end_of_turn: true,
    transcript: turns.map((t) => t.transcript).join(' ').replace(/\s+/g, ' ').trim(),
    words: turns.flatMap((t) => t.words ?? []),
  };
}

const rows = [];
let i = 0;
for (const r of evidence.rows) {
  i++;
  const patient = joined(r.patient);
  const fastText = joined(r.fast).transcript;
  let decision = cache[r.id];
  if (!decision && !rescore) {
    if (!patient.transcript) {
      decision = { action: 'hold', rule: 7, text: null, reason: 'nothing heard', models: 0 };
    } else {
      const ev = assembleEvidence({ patient, fastFinals: r.fast.map((t) => ({ type: 'Turn', end_of_turn: true, ...t })) });
      const res = await runDissent(ev, { apiKey: key, ...(MODEL ? { model: MODEL } : {}), mode: 'serial', live: false, maxRetries: 6, callerName: 'The caller', lexicon: [] });
      decision = {
        action: res.decision.action,
        rule: res.decision.policyRule,
        reason: res.decision.reason,
        text: res.decision.action === 'relay' ? res.decision.text : null,
        advocate: res.advocate?.say ?? null,
        skeptic: res.skeptic?.reading ?? null,
        blocked: res.deterministic.invented,
        minConfidence: ev.minConfidence,
        disagreements: ev.disagreement.length,
        models: (res.timings.advocateMs !== null ? 1 : 0) + (res.timings.skepticMs !== null ? 1 : 0),
      };
    }
    cache[r.id] = decision;
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
  }
  if (!decision) continue;

  const score = (relayed) => relayed
    ? { relayed, invented: findInventedWords(claim(relayed), r.prompt), inverted: isInverted(claim(relayed), r.prompt), wer: wer(claim(relayed), r.prompt), wrong: materiallyWrong(claim(relayed), r.prompt) }
    : { relayed: null, invented: [], inverted: false, wer: null, wrong: false };
  const row = {
    id: r.id, speaker: r.speaker, prompt: r.prompt, mic: r.mic, audioMs: r.audioMs, endedBy: r.endedBy,
    fastTurns: r.fast.length, patientTurns: r.patient.length,
    heard: { fast: fastText, patient: patient.transcript },
    wer: { fast: wer(fastText, r.prompt), patient: wer(patient.transcript, r.prompt) },
    ordinary: score(fastText || null),
    patient: score(patient.transcript || null),
    oneMoment: { ...score(decision.text), action: decision.action, rule: decision.rule, reason: decision.reason, advocate: decision.advocate ?? null, models: decision.models ?? 0 },
  };
  // What the product's own self-audit (audit.ts grade) would say about One Moment's relay.
  const c = careful[r.id];
  if (c) {
    const g = grade({ careful: { text: c.text, words: c.words ?? [], model: c.model ?? 'pre-recorded' }, patientTurns: r.patient.map((t) => ({ type: 'Turn', end_of_turn: true, ...t })), relays: decision.text ? [decision.text] : [], callerName: 'The caller', ms: 0 });
    row.careful = { text: c.text, wer: wer(c.text, r.prompt), flagged: g.relays[0] ? !g.relays[0].confirmed : null, missing: g.relays[0]?.missing ?? [] };
  }
  rows.push(row);
  const tag = (a) => (!a.relayed ? 'asked' : a.wrong ? `WRONG ${a.invented.slice(0, 3).join(',')}${a.inverted ? ' flip' : ''}` : 'ok');
  console.log(`${String(i).padStart(3)} ${r.id.padEnd(22)} ordinary: ${tag(row.ordinary).padEnd(28)} one-moment: ${tag(row.oneMoment).padEnd(24)} rule ${decision.rule}`);
}

// ---- summary --------------------------------------------------------------------
const arm = (k) => {
  const spoke = rows.filter((x) => x[k].relayed);
  return {
    spoke: spoke.length,
    wrong: spoke.filter((x) => x[k].wrong).length,
    invented: spoke.filter((x) => x[k].invented.length).length,
    flipped: spoke.filter((x) => x[k].inverted).length,
    meanWer: spoke.length ? spoke.reduce((s, x) => s + x[k].wer, 0) / spoke.length : null,
  };
};
const asked = rows.filter((x) => !x.oneMoment.relayed);
const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
const summary = {
  sentences: rows.length,
  speakers: [...new Set(rows.map((x) => x.speaker))].sort(),
  ordinary: arm('ordinary'),
  patient: arm('patient'),
  oneMoment: {
    ...arm('oneMoment'),
    asked: asked.length,
    askedNeeded: asked.filter((x) => x.ordinary.wrong).length,
    askedUnneeded: asked.filter((x) => !x.ordinary.wrong).length,
    byRule: Object.fromEntries([...new Set(rows.map((x) => x.oneMoment.rule))].sort((a, b) => a - b).map((n) => [n, rows.filter((x) => x.oneMoment.rule === n).length])),
    modelCalls: rows.reduce((s, x) => s + x.oneMoment.models, 0),
  },
  turns: {
    fastSplit: rows.filter((x) => x.fastTurns > 1).length,
    patientSplit: rows.filter((x) => x.patientTurns > 1).length,
    endedEarly: rows.filter((x) => x.endedBy === 'early').length,
    endedCap: rows.filter((x) => x.endedBy === 'cap').length,
  },
  wer: { fast: mean(rows.map((x) => x.wer.fast)), patient: mean(rows.map((x) => x.wer.patient)), careful: mean(rows.filter((x) => x.careful).map((x) => x.careful.wer)) },
  audit: (() => {
    const graded = rows.filter((x) => x.careful && x.oneMoment.relayed);
    const wrong = graded.filter((x) => x.oneMoment.wrong);
    const right = graded.filter((x) => !x.oneMoment.wrong);
    return { graded: graded.length, wrongRelays: wrong.length, wrongFlagged: wrong.filter((x) => x.careful.flagged).length, rightRelays: right.length, rightFlagged: right.filter((x) => x.careful.flagged).length };
  })(),
};

const result = {
  ranAt: new Date().toISOString(),
  corpus: 'TORGO (Rudzicz, Namasivayam and Wolff, 2012), speakers with dysarthria, read sentences',
  licence: 'Free for academic, non-profit use. No audio is redistributed; only transcripts of our own runs and the published prompts.',
  engine: 'packages/core runDissent (the product), both ears streamed live through AssemblyAI Universal-Streaming',
  model: MODEL ?? 'discovered',
  summary,
  rows,
};
fs.writeFileSync(path.join(here, 'results', `audiobench-${result.ranAt.slice(0, 10)}.json`), JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(here, '..', 'apps', 'web', 'src', 'content', 'audiobench.json'), JSON.stringify(result, null, 1));
console.log('\n' + JSON.stringify(summary, null, 2));
