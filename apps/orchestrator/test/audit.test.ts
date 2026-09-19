import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade } from '../src/audit.ts';

const careful = (text: string) => ({ text, words: [], model: 'universal-3-5-pro' });

test('the self-audit does not count reporting words the relay adds as unheard', () => {
  // A model-path relay, measured on real dysarthric speech (TORGO), 19 Sept.
  const a = grade({ careful: careful('Seed is needed to plant the spring corn.'), patientTurns: [], relays: ['He is saying seed is needed to plant the spring corn.'], callerName: 'The caller', ms: 0 });
  assert.equal(a.allConfirmed, true);
  assert.deepEqual(a.relays[0]!.missing, []);
});

test('the self-audit flags a relayed word the careful model did not hear', () => {
  // Both live ears heard "a slow walk in the open air again"; the speaker read "each day".
  const a = grade({ careful: careful('He slowly takes a short walk in the open air each day.'), patientTurns: [], relays: ['The caller says: He slowly takes a slow walk in the open air again.'], callerName: 'The caller', ms: 0 });
  assert.equal(a.allConfirmed, false);
  assert.ok(a.relays[0]!.missing.includes('again'));
});
