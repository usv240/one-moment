import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VOICE, isVoice, VOICE_IDS, VOICES, voiceOrDefault } from '../src/index.ts';

// Every id in this list was accepted by a real agent create on 19 Sept 2026,
// and the list itself is the API's own answer to an unknown voice id.
test('the voice list is the set AssemblyAI accepts, and the default is in it', () => {
  assert.equal(VOICES.length, VOICE_IDS.length);
  assert.ok(VOICE_IDS.includes(DEFAULT_VOICE));
  assert.equal(new Set(VOICE_IDS).size, VOICE_IDS.length, 'no duplicates');
  for (const v of VOICES) assert.ok(v.label && v.label[0] === v.label[0]?.toUpperCase());
});

// A voice id is a string from a visitor's browser, and it goes straight into an
// agent create. It must never be anything but one of ours.
test('a voice from outside is only used when it is one we verified', () => {
  assert.equal(isVoice('george'), true);
  for (const bad of ['', 'GEORGE', 'not-a-voice', 'anna ', 42, null, undefined, {}, ['anna']]) {
    assert.equal(isVoice(bad), false, `${JSON.stringify(bad)} must not pass`);
    assert.equal(voiceOrDefault(bad), DEFAULT_VOICE);
  }
  assert.equal(voiceOrDefault('michael'), 'michael');
});
