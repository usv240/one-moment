// npm run verify
//
// Re-derives every published number from the committed run files and fails if
// the website's figures are not what the underlying rows say.
//
// The point is not that the code works; the tests cover that. The point is that
// nobody, including us, can quietly improve a number after the run. Every relay
// in both benchmarks is scored again from scratch by eval/score.mjs, against the
// ground truth we did not write, and the aggregates are recomputed from those
// fresh scores and compared with what the site renders. The recorded call is
// replayed through the same invariant the live call asserts.
//
// Writes apps/web/src/content/verify.json, which the evidence page renders, so
// the page can never claim a check that did not run.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { claim, findInventedWords, isInverted, materiallyWrong, wer } from './score.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const content = (f) => JSON.parse(fs.readFileSync(path.join(repo, 'apps', 'web', 'src', 'content', f), 'utf8'));

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${detail}`);
};
/** Compare two objects field by field, returning the fields that differ. */
const diff = (got, want, keys) => keys.filter((k) => JSON.stringify(got[k]) !== JSON.stringify(want[k]));
const near = (a, b) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-9);

// ---- NEGBENCH: every row scored again, then the aggregate rebuilt ----------------
{
  const b = content('negbench.json');
  const bad = [];
  for (const r of b.rows) {
    for (const arm of ['baseline', 'full']) {
      const said = r[arm].relayed;
      if (!said) continue;
      const invented = findInventedWords(claim(said), r.groundTruth);
      const inverted = isInverted(claim(said), r.groundTruth);
      if (JSON.stringify(invented) !== JSON.stringify(r[arm].invented) || inverted !== r[arm].inverted) {
        bad.push(`${r.condition}/${arm}: "${said}"`);
      }
    }
  }
  check('NEGBENCH rows score the same today', bad.length === 0,
    bad.length ? `${bad.length} rows differ, first: ${bad[0]}` : `${b.rows.length} relays re-scored against the Harvard Sentences, all identical`);

  // Rebuild byCondition from the rows alone.
  const wrong = [];
  for (const cond of b.conditions) {
    const rows = b.rows.filter((r) => r.condition === cond);
    for (const arm of ['baseline', 'full']) {
      const a = rows.filter((r) => r[arm].relayed);
      const built = {
        n: rows.length,
        relayed: a.length,
        asked: rows.filter((r) => !r[arm].relayed).length,
        withInventedWords: a.filter((r) => r[arm].invented.length).length,
        negationCasesRelayed: a.filter((r) => r.hasNegation).length,
        negationFlipped: a.filter((r) => r.hasNegation && r[arm].inverted).length,
      };
      const d = diff(built, b.byCondition[cond][arm], Object.keys(built));
      if (d.length) wrong.push(`${cond}.${arm}: ${d.join(', ')}`);
    }
    const overAsked = rows.filter((r) => !r.full.relayed && !materiallyWrong(claim(r.baseline.relayed), r.groundTruth)).length;
    if (overAsked !== b.byCondition[cond].overAsked) wrong.push(`${cond}.overAsked ${overAsked} not ${b.byCondition[cond].overAsked}`);
  }
  check('NEGBENCH published totals match its rows', wrong.length === 0,
    wrong.length ? wrong.join('; ') : `${b.conditions.length} conditions rebuilt from ${b.rows.length} rows`);
}

// ---- AUDIOBENCH: the same, against prompts we did not write ---------------------
{
  const a = content('audiobench.json');
  const s = a.summary;
  const bad = [];
  for (const r of a.rows) {
    for (const arm of ['ordinary', 'patient', 'oneMoment']) {
      const said = r[arm].relayed;
      if (!said) continue;
      const c = claim(said);
      if (JSON.stringify(findInventedWords(c, r.prompt)) !== JSON.stringify(r[arm].invented)
        || isInverted(c, r.prompt) !== r[arm].inverted
        || materiallyWrong(c, r.prompt) !== r[arm].wrong
        || !near(wer(c, r.prompt), r[arm].wer)) bad.push(`${r.id}/${arm}`);
    }
  }
  check('AUDIOBENCH rows score the same today', bad.length === 0,
    bad.length ? `${bad.length} rows differ, first: ${bad[0]}` : `${a.rows.length} sentences re-scored against the TORGO prompts, all identical`);

  const arm = (k) => {
    const spoke = a.rows.filter((x) => x[k].relayed);
    return {
      spoke: spoke.length,
      wrong: spoke.filter((x) => x[k].wrong).length,
      invented: spoke.filter((x) => x[k].invented.length).length,
      flipped: spoke.filter((x) => x[k].inverted).length,
    };
  };
  const wrong = [];
  for (const k of ['ordinary', 'patient', 'oneMoment']) {
    const d = diff(arm(k), s[k], ['spoke', 'wrong', 'invented', 'flipped']);
    if (d.length) wrong.push(`${k}: ${d.join(', ')}`);
  }
  const asked = a.rows.filter((x) => !x.oneMoment.relayed);
  if (asked.length !== s.oneMoment.asked) wrong.push(`asked ${asked.length} not ${s.oneMoment.asked}`);
  if (asked.filter((x) => x.ordinary.wrong).length !== s.oneMoment.askedNeeded) wrong.push('askedNeeded');
  if (a.rows.filter((x) => x.fastTurns > 1).length !== s.turns.fastSplit) wrong.push('turns.fastSplit');
  if (a.rows.filter((x) => x.patientTurns > 1).length !== s.turns.patientSplit) wrong.push('turns.patientSplit');
  if (a.rows.length !== s.sentences) wrong.push('sentences');
  check('AUDIOBENCH published totals match its rows', wrong.length === 0,
    wrong.length ? wrong.join('; ') : `${s.sentences} sentences, ${s.speakers.length} speakers, every arm rebuilt from the rows`);

  // The claim that costs us something: it is not allowed to quietly drop.
  check('AUDIOBENCH still reports its own failures', s.oneMoment.wrong > 0 && s.oneMoment.askedUnneeded > 0 && s.audit.wrongFlagged < s.audit.wrongRelays,
    `${s.oneMoment.wrong} wrong relays, ${s.oneMoment.askedUnneeded} questions that were not needed, self-audit caught ${s.audit.wrongFlagged} of ${s.audit.wrongRelays}`);
}

// ---- The recorded call: the product's own invariant, replayed -------------------
for (const file of ['recorded-call.json', 'recorded-call-choice.json']) {
  const rec = JSON.parse(fs.readFileSync(path.join(repo, 'apps', 'web', 'src', 'content', file), 'utf8'));
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const approved = new Set(rec.events.filter((m) => m.type === 'outward').flatMap((m) => norm(m.text).split(' ')));
  const spoken = rec.events.filter((m) => m.type === 'agent_spoke');
  const unapproved = spoken.flatMap((m) => norm(m.text).split(' ').filter((w) => w && !approved.has(w)));
  check(`${file}: every word the agent spoke was approved`, unapproved.length === 0,
    unapproved.length ? `unapproved: ${unapproved.slice(0, 8).join(', ')}` : `${spoken.length} replies, ${approved.size} approved words, 0 unapproved`);
}

// ---- The engine itself ----------------------------------------------------------
let tests = null;
try {
  const out = execFileSync(process.execPath, ['--test', 'packages/*/test/*.test.ts', 'apps/orchestrator/test/*.test.ts'],
    { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const num = (k) => Number(out.match(new RegExp(`^# ${k} (\\d+)$`, 'm'))?.[1] ?? out.match(new RegExp(`${k} (\\d+)`))?.[1] ?? 0);
  tests = { total: num('tests'), pass: num('pass'), fail: num('fail') };
  check('the engine tests pass', tests.fail === 0 && tests.pass > 0, `${tests.pass} of ${tests.total} passing, ${tests.fail} failing`);
} catch (err) {
  check('the engine tests pass', false, (err.stdout ?? err.message).toString().slice(-300));
}

// ---- Result ---------------------------------------------------------------------
const failed = checks.filter((c) => !c.ok);
const out = { ranAt: new Date().toISOString(), checks, tests, ok: failed.length === 0 };
fs.writeFileSync(path.join(repo, 'apps', 'web', 'src', 'content', 'verify.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`\n${failed.length ? `${failed.length} CHECK(S) FAILED` : `all ${checks.length} checks passed`}`);
process.exit(failed.length ? 1 : 0);
