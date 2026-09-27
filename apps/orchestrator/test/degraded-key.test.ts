import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyRefused } from '../src/server.ts';

// A public demo outlives the credit that pays for it. When the shared key runs
// out, the orchestrator is still up, so nothing looks broken until a visitor
// clicks and gets a red error instead of the thing they came to see. Detecting
// that state is what lets the website fall back to the recordings instead.
test('a key that has run out or been revoked is recognised', () => {
  for (const m of [
    'agent create failed 401: {"error":"Unauthorized"}',
    'HTTP 402 Payment Required',
    'streaming failed 403: forbidden',
    'Invalid API key',
    'authentication failed',
    'insufficient credit on this account',
    'account balance exhausted',
    'quota exceeded for this key',
  ]) assert.equal(keyRefused(m), true, `should be treated as a dead key: ${m}`);
});

// The opposite mistake is worse in a different way: hiding a working demo
// because one call happened to fail. Only a refusal counts.
test('an ordinary failure is not mistaken for a dead key', () => {
  for (const m of [
    'Too many concurrent sessions',
    'socket hang up',
    'ETIMEDOUT',
    'Far-party endpoint not resolvable by AssemblyAI yet',
    'no data chunk in fixture.wav',
    'The engine is at capacity right now.',
    'ffmpeg exited with code 1',
  ]) assert.equal(keyRefused(m), false, `should not be treated as a dead key: ${m}`);
});
