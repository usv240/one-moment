import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjudicate, assembleEvidence, deterministicFindings, inventedWords, lexiconChoice, validateChoice,
  type AdvocateOutput, type SkepticOutput,
} from '../src/index.ts';
import { HARVARD_INVERSIONS, turn } from './fixtures.ts';

const decide = (ev: ReturnType<typeof assembleEvidence>, advocate: AdvocateOutput | null, skeptic: SkepticOutput | null) =>
  adjudicate({ ev, advocate, skeptic, det: deterministicFindings(ev, advocate) });

const agree = (say: string, polarity: 'affirmative' | 'negative' = 'affirmative'): SkepticOutput =>
  ({ negationRisk: false, unsupported: [], polarity, reading: say });

test('a grounded sentence is relayed (rule 8)', () => {
  const ev = assembleEvidence({ patient: turn('I need to refill my amlodipine prescription please') });
  const adv: AdvocateOutput = { say: 'He needs to refill his amlodipine prescription.', polarity: 'affirmative', guessed: [] };
  const d = decide(ev, adv, agree(adv.say));
  assert.equal(d.action, 'relay');
  assert.equal(d.policyRule, 8);
});

test('the canonical Robert case: an invented word blocks the relay (rule 2)', () => {
  const ev = assembleEvidence({ patient: turn('my the white one heart not refill') });
  const adv: AdvocateOutput = { say: 'He does not want a refill of his heart medication.', polarity: 'negative', guessed: [] };
  assert.deepEqual(inventedWords(adv.say, ev), ['medication']);
  const d = decide(ev, adv, agree(adv.say, 'negative'));
  assert.equal(d.action, 'ask');
  assert.equal(d.policyRule, 2);
});

test('an Advocate that drops a heard "not" is caught without any model (rule 3)', () => {
  const ev = assembleEvidence({ patient: turn('the white one heart not refill') });
  const adv: AdvocateOutput = { say: 'He wants a refill.', polarity: 'affirmative', guessed: [] };
  const d = decide(ev, adv, agree(adv.say));
  assert.equal(d.action, 'ask');
  assert.equal(d.policyRule, 3);
});

for (const c of HARVARD_INVERSIONS) {
  test(`real NEGBENCH inversion is blocked when the fast stream heard the negator: "${c.truth}"`, () => {
    // The patient stream lost the negator. The fast stream, listening
    // differently, kept it. The streams disagree about a "not", so rule 1
    // fires before any model output is even considered.
    const ev = assembleEvidence({ patient: turn(c.degraded), fastFinals: [turn(c.truth)] });
    const adv: AdvocateOutput = { say: c.baseline, polarity: 'affirmative', guessed: [] };
    const d = decide(ev, adv, agree(c.baseline));
    assert.equal(d.action, 'ask');
    assert.equal(d.policyRule, 1);
  });
}

test('honest limit: if BOTH streams lose the negator, the text alone cannot reveal it', () => {
  // Recorded on purpose. This is why the audio-level benchmark matters, and why
  // the site must not claim the system "catches negations" in general.
  const c = HARVARD_INVERSIONS[0]!;
  const ev = assembleEvidence({ patient: turn(c.degraded), fastFinals: [turn(c.degraded)] });
  const adv: AdvocateOutput = { say: c.baseline, polarity: 'affirmative', guessed: [] };
  assert.equal(decide(ev, adv, agree(c.baseline)).action, 'relay');
});

test('a low-confidence negator is enough to ask (rule 1)', () => {
  const t = turn('I do not want it');
  t.words[2]!.confidence = 0.41;
  const ev = assembleEvidence({ patient: t });
  const adv: AdvocateOutput = { say: 'He does not want it.', polarity: 'negative', guessed: [] };
  assert.equal(decide(ev, adv, agree(adv.say, 'negative')).policyRule, 1);
});

test('Advocate and Skeptic reading in opposite directions forces a question (rule 4)', () => {
  const ev = assembleEvidence({ patient: turn('refill tablet') });
  const adv: AdvocateOutput = { say: 'He wants a refill of the tablet.', polarity: 'affirmative', guessed: [] };
  const sk: SkepticOutput = { negationRisk: false, unsupported: [], polarity: 'negative', reading: 'He may be refusing the tablet.' };
  assert.equal(decide(ev, adv, sk).policyRule, 4);
});

test('a turn that is still open is held, never decided (rule 7)', () => {
  const ev = assembleEvidence({ patient: turn('I need to', { final: false }) });
  assert.equal(decide(ev, null, null).action, 'hold');
});

test('an unreadable model reply fails closed (rule 0)', () => {
  const ev = assembleEvidence({ patient: turn('I need my tablets') });
  assert.equal(decide(ev, null, null).policyRule, 0);
});

test('forced-choice validator rejects yes/no, long labels and wrong counts', () => {
  assert.ok(validateChoice({ prompt: 'Refill?', options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] }).length > 0);
  assert.ok(validateChoice({ prompt: 'Which?', options: [{ id: 'a', label: 'I would like a new one please' }, { id: 'b', label: 'Stop' }] }).length > 0);
  assert.ok(validateChoice({ prompt: 'Which?', options: [{ id: 'a', label: 'A' }] }).length > 0);
  assert.equal(validateChoice({ prompt: 'A new one, or stop it?', options: [{ id: 'a', label: 'A new one' }, { id: 'b', label: 'Stop it' }] }).length, 0);
});

test('an unconfirmed boosted drug name becomes a forced choice against its sibling', () => {
  const lexicon = [
    { term: 'amlodipine', category: 'medication' as const },
    { term: 'metformin', category: 'medication' as const },
  ];
  const ev = assembleEvidence({ patient: turn('I need my amlodipine'), fastFinals: [turn('I need my am load a peen')], lexicon });
  const q = lexiconChoice(ev, lexicon);
  assert.ok(q);
  assert.equal(q.prompt, 'Amlodipine, or metformin?');
  assert.equal(validateChoice(q).length, 0);
});

test('each forced-choice option carries the full grounded sentence to relay', () => {
  const lexicon = [
    { term: 'amlodipine', category: 'medication' as const },
    { term: 'metformin', category: 'medication' as const },
  ];
  const ev = assembleEvidence({ patient: turn('I need my amlodipine'), fastFinals: [turn('I need my am load a peen')], lexicon });
  const q = lexiconChoice(ev, lexicon, 'He is asking about his amlodipine.');
  assert.ok(q);
  assert.equal(q.options[0]!.relay, 'He is asking about his amlodipine.');
  assert.equal(q.options[1]!.relay, 'He is asking about his metformin.');
});

// ---- verbatim-first ------------------------------------------------------------

import { runDissent, verbatimEligible } from '../src/index.ts';
import { PATIENT_PAUSE_6S } from './fixtures.ts';

test('the live-API sentence is relayed verbatim, with zero model calls', async () => {
  const ev = assembleEvidence({ patient: PATIENT_PAUSE_6S });
  assert.equal(verbatimEligible(ev), true);
  // No API key at all: if this path touched a model, it would fail.
  const r = await runDissent(ev, { apiKey: '', callerName: 'Robert', live: true });
  assert.equal(r.decision.action, 'relay');
  assert.equal(r.decision.policyRule, 9);
  assert.equal((r.decision as { text: string }).text, 'Robert says: I need to refill my amlodipine prescription, please.');
});

test('a fragment is never relayed verbatim', () => {
  const ev = assembleEvidence({ patient: turn('my the white one heart not refill') });
  assert.equal(verbatimEligible(ev), false);
});

test('a complete sentence the fast stream heard differently is not relayed verbatim', () => {
  const ev = assembleEvidence({ patient: turn('I need my amlodipine refill.'), fastFinals: [turn('I need my am load a peen refill.')] });
  assert.equal(verbatimEligible(ev), false);
});

test('a disputed negation beats even a complete sentence (rule 1 before verbatim)', async () => {
  const ev = assembleEvidence({ patient: turn('An abrupt start does win the prize.'), fastFinals: [turn('An abrupt start does not win the prize.')] });
  const r = await runDissent(ev, { apiKey: '', callerName: 'Robert', live: true });
  assert.equal(r.decision.policyRule, 1);
});
