import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleEvidence, buildQuestion, negationChoice, runDissent, validateChoice } from '../src/index.ts';
import { turn } from './fixtures.ts';

test('a disputed "not" is asked about with the two readings the ears actually heard', () => {
  const ev = assembleEvidence({
    patient: turn('I am taking the metformin.'),
    // Same audio, one more word: it starts a little earlier on the shared clock.
    fastFinals: [turn('I am not taking the metformin.', { start: 100 })],
  });
  const q = negationChoice(ev, 'Robert');
  assert.ok(q, 'a question is produced without any model');
  assert.deepEqual(validateChoice(q), []);
  assert.deepEqual(q.options.map((o) => o.label), ['Taking the metformin', 'Not taking the metformin']);
  assert.equal(q.options[0]!.relay, 'Robert says: I am taking the metformin.');
  assert.equal(q.options[1]!.relay, 'Robert says: I am not taking the metformin.');
});

test('no negation question when the ears agree', () => {
  const ev = assembleEvidence({
    patient: turn('I am not taking the metformin.'),
    fastFinals: [turn('I am not taking the metformin.')],
  });
  assert.equal(negationChoice(ev), null);
});

test('rule 11: a boosted word only the boosted ear heard is asked about, as a choice of the caller\'s own words', async () => {
  const lexicon = [{ term: 'amlodipine', category: 'medication' as const }, { term: 'metformin', category: 'medication' as const }];
  // Measured 18 Sept: "am low dippy" came back as amlodipine from the boosted ear only.
  const ev = assembleEvidence({
    patient: turn('I need to refill my amlodipine prescription, please.'),
    fastFinals: [turn('I need to refill my AMLO Dippy prescription, please.', { start: 400 })],
    lexicon,
  });
  const result = await runDissent(ev, { apiKey: '', callerName: 'Robert', noModels: true, lexicon });
  assert.equal(result.decision.action, 'ask');
  assert.equal(result.decision.policyRule, 11);
  const q = await buildQuestion({ result, ev, lexicon, gateway: { apiKey: '', model: null }, callerName: 'Robert' });
  assert.equal(q.prompt, 'Amlodipine, or metformin?');
  assert.deepEqual(q.options.map((o) => o.relay), [
    'Robert says: I need to refill my amlodipine prescription please.',
    'Robert says: I need to refill my metformin prescription please.',
  ]);
});

test('rule 11: a partial attempt at a word on the list is offered, never assumed', async () => {
  const lexicon = [{ term: 'amlodipine', category: 'medication' as const }, { term: 'metformin', category: 'medication' as const }];
  // The live patient ear, measured 18 Sept, on "um, am, am lo, prescription, please".
  const ev = assembleEvidence({
    patient: turn('I need to refill my— um, am, am, um, low prescription, please.'),
    fastFinals: [turn('I need to refill my, um, am. Am. Am low, prescription please.', { start: 250 })],
    lexicon,
  });
  const result = await runDissent(ev, { apiKey: '', callerName: 'Robert', noModels: true, lexicon });
  assert.equal(result.decision.policyRule, 11);
  assert.equal(result.decision.action, 'ask');
  const q = await buildQuestion({ result, ev, lexicon, gateway: { apiKey: '', model: null }, callerName: 'Robert' });
  assert.equal(q.prompt, 'Amlodipine, or metformin?');
  assert.equal(q.options[0]!.relay, 'Robert says: I need to refill my amlodipine prescription please.');
});

test('rule 11 ignores generic words: never "prescription, or refill?"', async () => {
  const lexicon = [{ term: 'prescription', category: 'other' as const }, { term: 'refill', category: 'other' as const }];
  const ev = assembleEvidence({
    patient: turn('I need to refill my prescription, please.'),
    fastFinals: [turn('I need to refill my subscription please.')],
    lexicon,
  });
  const result = await runDissent(ev, { apiKey: '', callerName: 'Robert', noModels: true, lexicon });
  assert.notEqual(result.decision.policyRule, 11);
});

test('a clear sentence with the full word is never mistaken for an attempt', async () => {
  const lexicon = [{ term: 'amlodipine', category: 'medication' as const }, { term: 'metformin', category: 'medication' as const }];
  const ev = assembleEvidence({
    patient: turn('I am looking for my amlodipine prescription.'),
    fastFinals: [turn('I am looking for my amlodipine prescription.')],
    lexicon,
  });
  const result = await runDissent(ev, { apiKey: '', callerName: 'Robert', noModels: true, lexicon });
  assert.equal(result.decision.policyRule, 9);
});

test('rule 11 stays quiet when both ears heard the word', async () => {
  const lexicon = [{ term: 'amlodipine', category: 'medication' as const }];
  const ev = assembleEvidence({
    patient: turn('I need to refill my amlodipine prescription, please.'),
    fastFinals: [turn('I need to refill my amlodipine prescription, please.')],
    lexicon,
  });
  const result = await runDissent(ev, { apiKey: '', callerName: 'Robert', noModels: true, lexicon });
  assert.equal(result.decision.policyRule, 9, 'relayed in his own words');
});
