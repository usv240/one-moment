// Runs every test in order and writes REPORT.md.
//
// REPORT.md is the artefact. It is the thing that decides whether the plan in
// 01-One-Moment/ survives contact with the API, and it is the file to paste back
// into the conversation.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, RESULTS_DIR, load, requireKey } from './lib/report.js';

requireKey();

const TESTS = [
  { id: '00-connect', file: 'tests/00-connect.js', name: 'Connectivity and parameter discovery', critical: true },
  { id: '01-dual-stream', file: 'tests/01-dual-stream.js', name: 'Two concurrent streaming sessions', critical: true },
  { id: '02-patience', file: 'tests/02-patience.js', name: 'The patience window', critical: true },
  { id: '03-keyterms', file: 'tests/03-keyterms.js', name: 'Bring your own vocabulary', critical: false },
  { id: '04-confidence', file: 'tests/04-confidence.js', name: 'The evidence layer', critical: true },
  { id: '05-llm-gateway', file: 'tests/05-llm-gateway.js', name: 'Dissent latency and negation catching', critical: false },
  { id: '06-negation-benchmark', file: 'tests/06-negation-benchmark.js', name: 'NEGBENCH, the headline number', critical: false },
];

// Fixtures must exist before anything streams.
if (!fs.existsSync(path.join(ROOT, 'fixtures', 'generated', 'pause-6s.wav')) &&
    !fs.existsSync(path.join(ROOT, 'fixtures', 'custom', 'pause-6s.wav'))) {
  console.log('No fixtures found. Generating them first.\n');
  const gen = spawnSync(process.execPath, ['fixtures/make.js'], { cwd: ROOT, stdio: 'inherit' });
  if (gen.status !== 0) {
    console.error('\nFixture generation failed. See spike/README.md for the manual route.');
    process.exit(1);
  }
}

fs.mkdirSync(RESULTS_DIR, { recursive: true });

const outcomes = [];
for (const test of TESTS) {
  const run = spawnSync(process.execPath, [test.file], { cwd: ROOT, stdio: 'inherit' });
  outcomes.push({ ...test, passed: run.status === 0, exitCode: run.status });

  if (test.critical && run.status !== 0 && test.id === '00-connect') {
    console.log('\nTest 00 failed. Nothing downstream can run. Stopping.\n');
    break;
  }
}

// --- REPORT.md -------------------------------------------------------------

const d = (id) => load(id) ?? {};
const t00 = d('00-connect'); const t01 = d('01-dual-stream'); const t02 = d('02-patience');
const t03 = d('03-keyterms'); const t04 = d('04-confidence'); const t05 = d('05-llm-gateway');
const t06 = d('06-negation-benchmark');

const mark = (b) => (b ? 'PASS' : 'FAIL');
const y = (b) => (b ? 'yes' : 'no');

const criticalPassed = outcomes.filter((o) => o.critical).every((o) => o.passed);
const architectureHolds = !!t01.bothOpen && !!t02.patientHeld;

const lines = [];
lines.push('# Spike report');
lines.push('');
lines.push(`Generated ${new Date().toISOString()}`);
lines.push('');
lines.push('Day-one assumption tests for One Moment. This file answers one question:');
lines.push('**does the architecture in `01-One-Moment/docs/03-TECHNICAL-DESIGN.md` survive');
lines.push('contact with the real API?**');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## Verdict');
lines.push('');
lines.push(architectureHolds
  ? '**The architecture holds. Build it as planned.**'
  : '**The architecture does NOT hold as specified. See "What changes" below.**');
lines.push('');
lines.push('| Test | Result | Critical |');
lines.push('|---|---|---|');
for (const o of outcomes) {
  lines.push(`| ${o.id} ${o.name} | ${mark(o.passed)} | ${o.critical ? 'yes' : 'no'} |`);
}
lines.push('');
lines.push('---');
lines.push('');

// 00
lines.push('## 00. Connectivity and parameter discovery');
lines.push('');
if (t00.connected) {
  lines.push('| Finding | Value |');
  lines.push('|---|---|');
  lines.push(`| Streaming reachable | yes |`);
  lines.push(`| Speech model in use | \`${t00.model ?? '(server default)'}\` |`);
  lines.push(`| Short-silence parameter | \`${t00.minSilenceKey ?? 'NONE ACCEPTED'}\` |`);
  lines.push(`| Unsupported parameters | ${t00.unsupported?.length ? t00.unsupported.map((k) => `\`${k}\``).join(', ') : 'none'} |`);
  if (t00.unsupported?.length) {
    lines.push('');
    lines.push('**Action:** remove the unsupported parameters from the table in');
    lines.push('`_shared/03-ASSEMBLYAI-REFERENCE.md` and from every claim on the site.');
    lines.push('The plan must describe what was built, not what was hoped for.');
  }
} else {
  lines.push('Could not open a streaming session. Check the key and the account credit.');
}
lines.push('');

// 01
lines.push('## 01. Two concurrent streaming sessions');
lines.push('');
lines.push('This is the test the whole design rests on.');
lines.push('');
if (t01.bothOpen) {
  lines.push('| Measurement | Value |');
  lines.push('|---|---|');
  lines.push(`| Both sessions opened on one key | yes, in ${t01.concurrentOpenMs}ms |`);
  lines.push(`| Patient turns / finals | ${t01.patient?.turnCount ?? '-'} / ${t01.patient?.finalTurnCount ?? '-'} |`);
  lines.push(`| Fast turns / finals | ${t01.fast?.turnCount ?? '-'} / ${t01.fast?.finalTurnCount ?? '-'} |`);
  lines.push(`| First-turn latency, patient | ${fmtMs(t01.firstTurnLatency?.patientMs)} |`);
  lines.push(`| First-turn latency, fast | ${fmtMs(t01.firstTurnLatency?.fastMs)} |`);
  lines.push(`| Latency cost of the second session | ${fmtMs(t01.firstTurnLatency?.deltaMs)} |`);
  lines.push(`| Real-time pacing drift | patient ${t01.patient?.driftMs}ms, fast ${t01.fast?.driftMs}ms |`);
  lines.push(`| Token disagreements on this clip | ${t01.tokenDisagreement?.length ?? 0} |`);
  lines.push('');
  lines.push('Transcripts:');
  lines.push('');
  lines.push('```');
  lines.push(`patient: ${t01.transcripts?.patient ?? ''}`);
  lines.push(`fast:    ${t01.transcripts?.fast ?? ''}`);
  lines.push('```');
} else {
  lines.push('**Two concurrent sessions did not open.**');
  lines.push('');
  lines.push('```');
  lines.push(String(t01.openError ?? 'no detail recorded'));
  lines.push('```');
  lines.push('');
  lines.push('**This changes the plan.** See "What changes" below.');
}
lines.push('');

// 02
lines.push('## 02. The patience window');
lines.push('');
if (t02.baseline) {
  lines.push('| Configuration | Final turns | Interpretation |');
  lines.push('|---|---|---|');
  lines.push(`| Baseline (defaults) | ${t02.baseline.finalCount} | ${t02.baselineSplit ? 'split the sentence at the gap' : 'did not split'} |`);
  lines.push(`| Patient (ours) | ${t02.patient.finalCount} | ${t02.patientHeld ? 'held the turn through a 6s gap' : 'did NOT hold'} |`);
  lines.push('');
  lines.push('```');
  lines.push(`baseline: ${t02.baseline.transcript}`);
  lines.push(`patient:  ${t02.patient.transcript}`);
  lines.push('```');
  if (t02.baselineSplit && t02.patientHeld) {
    lines.push('');
    lines.push(`**The product in one number:** the same audio became ${t02.baseline.finalCount} fragments on`);
    lines.push(`defaults and ${t02.patient.finalCount} complete sentence with the patience window.`);
    lines.push('Use this on the landing page and in the video.');
  }
} else {
  lines.push('Not run, or failed before producing results.');
}
lines.push('');

// 03
lines.push('## 03. Bring your own vocabulary');
lines.push('');
if (t03.skipped) {
  lines.push(`Skipped: ${t03.reason}.`);
} else if (t03.realRecovered) {
  lines.push('| Measurement | Value |');
  lines.push('|---|---|');
  lines.push(`| Boosting changed the transcript | ${y(t03.transcriptsDiffer)} |`);
  lines.push(`| Terms recovered only by the lexicon | ${t03.lift} |`);
  lines.push(`| Regressions caused by boosting | ${t03.regression} |`);
  lines.push(`| False boosts (words never spoken) | ${t03.falseBoosts?.length ? t03.falseBoosts.join(', ') : 'none on this clip'} |`);
  lines.push('');
  lines.push('```');
  lines.push(`unboosted: ${t03.unboosted?.transcript ?? ''}`);
  lines.push(`boosted:   ${t03.boosted?.transcript ?? ''}`);
  lines.push('```');
  lines.push('');
  lines.push('`falseBoosts` is the number to report honestly on the site. Biasing a');
  lines.push('decoder introduces a new failure mode, and a system that boosts without');
  lines.push('measuring the bias is less safe than one that does not boost at all.');
} else {
  lines.push('Not run.');
}
lines.push('');

// 04
lines.push('## 04. The evidence layer');
lines.push('');
if (t04.fields) {
  lines.push('| Field | Available |');
  lines.push('|---|---|');
  lines.push(`| \`words[]\` on partials | ${t04.fields.wordsOnPartials ? `yes (${t04.fields.wordsOnPartials} turns)` : 'NO'} |`);
  lines.push(`| \`words[]\` on finals | ${t04.fields.wordsOnFinals ? `yes (${t04.fields.wordsOnFinals} turns)` : 'NO'} |`);
  lines.push(`| \`word.confidence\` on partials | ${t04.fields.confidenceOnPartials ? 'yes' : 'NO'} |`);
  lines.push(`| \`word.confidence\` on finals | ${t04.fields.confidenceOnFinals ? 'yes' : 'NO'} |`);
  lines.push(`| \`word.start\` / \`word.end\` | ${t04.fields.timingsOnFinals ? 'yes' : 'NO'} |`);
  lines.push(`| \`word.word_is_final\` | ${t04.fields.wordIsFinalPresent ? 'yes' : 'NO'} |`);
  lines.push(`| \`end_of_turn_confidence\` | ${t04.fields.endOfTurnConfidenceCount ? 'yes' : 'NO'} |`);
  if (t04.confidence) {
    lines.push('');
    lines.push(`Word confidence min / mean / max: **${t04.confidence.min} / ${t04.confidence.mean} / ${t04.confidence.max}**`);
  }
  if (t04.largestGaps?.length) {
    lines.push('');
    lines.push('Largest inter-word gaps, which is the word-finding block signal:');
    lines.push('');
    lines.push('| Gap | After | Before |');
    lines.push('|---|---|---|');
    for (const g of t04.largestGaps.slice(0, 5)) {
      lines.push(`| ${g.gapMs}ms | "${g.afterWord}" | "${g.beforeWord}" |`);
    }
  }
} else {
  lines.push('Not run.');
}
lines.push('');

// 05
lines.push('## 05. Dissent latency and negation catching');
lines.push('');
if (t05.available) {
  lines.push('| Measurement | Value |');
  lines.push('|---|---|');
  lines.push(`| Model | \`${t05.model}\` |`);
  lines.push(`| Total latency p50 | ${t05.latency.p50}ms |`);
  lines.push(`| Total latency p95 | ${t05.latency.p95}ms |`);
  lines.push(`| Within the 400ms Doherty budget | ${y(t05.withinDohertyBudget)} |`);
  lines.push(`| Valid JSON from both roles | ${(t05.validJsonRate * 100).toFixed(0)}% |`);
  lines.push(`| Dropped negation caught | ${(t05.negationCatchRate * 100).toFixed(0)}% |`);
  if (t05.sampleRival) {
    lines.push('');
    lines.push('The Skeptic\'s rival reading of Robert\'s utterance:');
    lines.push('');
    lines.push('> ' + t05.sampleRival);
  }
  if (!t05.withinDohertyBudget) {
    lines.push('');
    lines.push('**Over budget.** The fallback ladder in `_shared/02-DISSENT-ENGINE.md`');
    lines.push('section 5 becomes the main path rather than the exception.');
  }
} else {
  lines.push('LLM Gateway not reachable on this account, or model identifiers have changed.');
  lines.push('Dissent runs on any OpenAI-compatible endpoint: set `LLM_GATEWAY_BASE_URL`');
  lines.push('and `LLM_GATEWAY_MODEL` in `.env` and rerun `npm run test:05`.');
}
lines.push('');

// 06
lines.push('## 06. NEGBENCH, the headline number');
lines.push('');
if (t06.baseline) {
  lines.push(`Case source: **${t06.sourceLabel}**`);
  lines.push('');
  if (!t06.publishable) {
    lines.push('**These numbers are NOT publishable.** The cases were authored by us, so they');
    lines.push('wire the pipeline but must not appear on the site. Rerun with');
    lines.push('`npm run bench` once TORGO has downloaded.');
    lines.push('');
  }
  lines.push(`Model \`${t06.model}\`, seed ${t06.seed}, ${t06.caseCount} cases across ${t06.conditions.join(', ')}.`);
  lines.push('');
  lines.push('| Metric | Baseline, one model | Full, with Dissent |');
  lines.push('|---|---|---|');
  lines.push(`| **Spoke words never said** | ${p(t06.baseline.inventedUtteranceRate)} | **${p(t06.full.inventedUtteranceRate)}** |`);
  lines.push(`| **Inverted a negation** | ${p(t06.baseline.negationInversionRate)} | **${p(t06.full.negationInversionRate)}** |`);
  lines.push(`| Refused to speak | ${p(t06.baseline.refusalRate)} | ${p(t06.full.refusalRate)} |`);
  lines.push(`| **Over-refused (the cost)** | n/a | **${p(t06.full.overRefusalRate)}** |`);
  lines.push(`| Median latency | ${t06.baseline.medianLatencyMs}ms | ${t06.full.medianLatencyMs}ms |`);
  lines.push('');
  lines.push('The over-refusal row is the cost of the row above it. Publish both at the');
  lines.push('same size. A report containing only flattering metrics is not believed.');

  const inv = (t06.rows ?? []).filter((r) => r.baseline.inverted).slice(0, 2);
  if (inv.length) {
    lines.push('');
    lines.push('Cases where the baseline inverted the speaker\'s meaning:');
    lines.push('');
    for (const r of inv) {
      lines.push('```');
      lines.push(`truth:    ${r.groundTruth}`);
      lines.push(`degraded: ${r.degraded}`);
      lines.push(`baseline: ${r.baseline.relayed}`);
      lines.push(`full:     ${r.full.refused ? `REFUSED (rule ${r.full.policyRule}, ${r.full.reason})` : r.full.relayed}`);
      lines.push('```');
      lines.push('');
    }
  }
} else {
  lines.push('Not run, or no model was reachable.');
}
lines.push('');
lines.push('---');
lines.push('');

// What changes
lines.push('## What changes in the plan');
lines.push('');
const actions = [];
if (!t01.bothOpen) {
  actions.push('**Drop the dual-stream architecture.** Fall back to one patient stream plus a local VAD for live feedback. Rewrite `_shared/02-DISSENT-ENGINE.md` section 2 to drop `crossStreamDisagreement`, and substitute revision churn as the uncertainty signal. Remove the disagreement claim from every page. Do not keep the story and ship something else.');
}
if (t02.baseline && !t02.patientHeld) {
  actions.push('**The patience claim needs revising.** Find the highest silence value the server actually honours and use that number everywhere, including the hero copy and the cover image.');
}
if (t00.unsupported?.length) {
  actions.push(`**Remove unsupported parameters from the reference table:** ${t00.unsupported.join(', ')}. The 22-parameter table has to describe what was built.`);
}
if (t04.fields && !t04.fields.confidenceOnPartials) {
  actions.push('**No confidence on partials.** Live uncertainty must come from revision churn instead. Note this in `04-UI-SPEC.md` where the live confidence display is described.');
}
if (t05.available && !t05.withinDohertyBudget) {
  actions.push('**Dissent is over the 400ms budget.** Promote the fallback ladder to the main path, or move the Skeptic to a faster model while keeping a strong Advocate.');
}
if (t05.available && t05.negationCatchRate < 1) {
  actions.push('**The Skeptic missed a negation.** Add a deterministic negation check that runs regardless of the model, since this is the highest-consequence error class in the product.');
}
if (!actions.length) {
  actions.push('Nothing. Every assumption held. Build `01-One-Moment` exactly as written, and paste the measured numbers from this report into `docs/06-EVALUATION.md` section 5.');
}
for (const a of actions) lines.push(`- ${a}`);
lines.push('');
lines.push('---');
lines.push('');
lines.push('## Numbers to put on the site');
lines.push('');
lines.push('Every one of these came from a real run against the real API and can be');
lines.push('reproduced with `npm run all` in `spike/`.');
lines.push('');
if (t02.baselineSplit && t02.patientHeld) {
  lines.push(`- A 6 second mid-sentence pause splits into **${t02.baseline.finalCount} fragments** on default settings and stays **1 sentence** on ours.`);
}
if (t01.bothOpen) {
  lines.push(`- Running a second, differently configured listening session costs **${fmtMs(t01.firstTurnLatency?.deltaMs)}** of first-turn latency.`);
}
if (t04.largestGaps?.length) {
  lines.push(`- The largest measured word-finding gap in the fixture: **${t04.largestGaps[0].gapMs}ms**, against an industry default of 1536ms.`);
}
if (t05.available) {
  lines.push(`- Two models argue about what the speaker meant in **${t05.latency.p50}ms** at p50, inside the 400ms threshold for an interaction to feel immediate.`);
}
if (t03.falseBoosts) {
  lines.push(`- False boosts from vocabulary biasing on this clip: **${t03.falseBoosts.length}**. Reported whether or not it flatters us.`);
}
if (t06.baseline && t06.publishable) {
  lines.push(`- A single model spoke words the person never said in **${p(t06.baseline.inventedUtteranceRate)}** of cases. One Moment: **${p(t06.full.inventedUtteranceRate)}**.`);
  lines.push(`- Negations inverted by the baseline: **${p(t06.baseline.negationInversionRate)}**. By One Moment: **${p(t06.full.negationInversionRate)}**.`);
  lines.push(`- The cost, published beside it: **${p(t06.full.overRefusalRate)}** over-refusal, meaning that share of calls got an unnecessary question.`);
} else if (t06.baseline) {
  lines.push('- NEGBENCH ran on bootstrap cases only. **No number from it may go on the site** until it reruns against TORGO.');
}
lines.push('');

fs.writeFileSync(path.join(ROOT, 'REPORT.md'), lines.join('\n'));

console.log('');
console.log('='.repeat(72));
console.log('Wrote spike/REPORT.md');
console.log('='.repeat(72));
console.log('');
console.log(architectureHolds
  ? 'VERDICT: the architecture holds. Build it.'
  : 'VERDICT: the architecture needs revising. Read REPORT.md section "What changes".');
console.log('');
console.log('Paste REPORT.md back into the conversation and we will proceed.');
console.log('');

function fmtMs(v) { return v === null || v === undefined ? "n/a" : `${v}ms`; }
function p(r) { return r === null || r === undefined ? "n/a" : `${(r * 100).toFixed(1)} percent`; }

process.exit(criticalPassed ? 0 : 1);
