import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignTokens, assembleEvidence, assessNegation, ChurnTracker, normalizeTokens,
  swallowedSilenceMs, fastWordsInWindow,
} from '../src/index.ts';
import { PATIENT_PAUSE_6S, PAUSE_6S_NON_SPEECH_MS, turn } from './fixtures.ts';

test('the swallowed-silence estimator recovers the real pause from live API timings', () => {
  const est = swallowedSilenceMs(PATIENT_PAUSE_6S.words);
  const err = Math.abs(est - PAUSE_6S_NON_SPEECH_MS) / PAUSE_6S_NON_SPEECH_MS;
  assert.ok(err < 0.02, `estimate ${est}ms vs actual ${PAUSE_6S_NON_SPEECH_MS}ms, error ${(err * 100).toFixed(1)}%`);
});

test('live API exposes no usable inter-word gap, so gaps alone would miss the block', () => {
  const ev = assembleEvidence({ patient: PATIENT_PAUSE_6S });
  assert.equal(ev.largestGapMs, 46);
  assert.ok(ev.blockWords.length > 0, 'duration-based detection must still find the block');
  assert.ok(ev.blockWords.some((b) => b.text.startsWith('prescription')));
});

test('alignment finds a substitution between the two streams', () => {
  const d = alignTokens(normalizeTokens('I need my amlodipine'), normalizeTokens('I need my am load a peen'));
  assert.ok(d.length > 0);
  assert.ok(d.some((x) => x.patient === 'amlodipine'));
});

test('alignment finds a negator only one stream heard', () => {
  const d = alignTokens(normalizeTokens('does win the prize'), normalizeTokens('does not win the prize'));
  assert.deepEqual(d, [{ index: 1, patient: null, fast: 'not', kind: 'fast_only' }]);
});

test('fast-stream words are gathered by time window, not by turn number', () => {
  const patient = turn('I need to refill my amlodipine', { start: 400 });
  const fastA = turn('I need to refill my', { order: 0, start: 400 });
  const fastB = turn('amlodipine', { order: 1, start: 2150 });
  const far = turn('something much later', { order: 2, start: 30000 });
  const got = fastWordsInWindow(patient, [fastA, fastB, far], 300).map((x) => x.text).join(' ');
  assert.equal(got, 'I need to refill my amlodipine');
});

test('a boosted lexicon term the fast stream did not hear is marked unconfirmed', () => {
  const ev = assembleEvidence({
    patient: turn('I need my amlodipine'),
    fastFinals: [turn('I need my am load a peen')],
    lexicon: [{ term: 'amlodipine', category: 'medication' }],
  });
  assert.deepEqual(ev.lexiconHits, [{ term: 'amlodipine', confirmedByFast: false }]);
});

test('negation is disputed when only one stream heard "not"', () => {
  const ev = assembleEvidence({
    patient: turn('an abrupt start does win the prize'),
    fastFinals: [turn('an abrupt start does not win the prize')],
  });
  const n = assessNegation(ev);
  assert.equal(n.disputed, true);
  assert.ok(n.reasons.length > 0);
});

test('"stop" is not treated as a negator (scorer false positive found in NEGBENCH)', () => {
  const ev = assembleEvidence({ patient: turn('bail the boat to stop it from sinking') });
  assert.equal(assessNegation(ev).present, false);
});

test('churn counts revisions, not extensions', () => {
  const c = new ChurnTracker();
  c.observe({ turn_order: 0, transcript: 'I need' });
  c.observe({ turn_order: 0, transcript: 'I need to' });
  c.observe({ turn_order: 0, transcript: 'I knead to' });
  c.observe({ turn_order: 0, transcript: 'I knead to refill' });
  assert.equal(c.churn(0), 1);
});
