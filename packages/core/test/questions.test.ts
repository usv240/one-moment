import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleEvidence, negationChoice, validateChoice } from '../src/index.ts';
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
