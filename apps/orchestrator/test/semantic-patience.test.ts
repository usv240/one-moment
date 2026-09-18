import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundsFinished } from '../src/call.ts';

// Semantic patience depends entirely on telling a finished sentence from one
// that trails off. These are the transcripts Universal-3.5 Pro actually produced
// on the demo call, measured 18 Sept.
test('a sentence that trails off is never treated as finished', () => {
  assert.equal(soundsFinished('I need to refill my...'), false);
  assert.equal(soundsFinished('I need to refill my…'), false);
  assert.equal(soundsFinished('I need to refill my'), false);
});

test('a finished sentence is', () => {
  assert.equal(soundsFinished('I need to refill my amlodipine prescription, please.'), true);
  assert.equal(soundsFinished('Is it ready?'), true);
  assert.equal(soundsFinished('He said "stop."'), true);
});
