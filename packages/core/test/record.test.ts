import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callRecord, recordAsText, type ServerMessage } from '../src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const recorded = (f: string) =>
  JSON.parse(fs.readFileSync(path.join(here, '../../../apps/web/src/content', f), 'utf8')) as { events: ServerMessage[] };

// The record is what the caller is handed afterwards, so the one thing it must
// never do is describe a call that did not happen. Built from a real recorded
// call, not a fixture we wrote.
test('the record of a real call says only what the call produced', () => {
  const { events } = recorded('recorded-call.json');
  const r = callRecord(events, { callId: 'test', caller: 'Robert' });

  const outward = events.filter((m) => m.type === 'outward');
  assert.equal(r.spokenForYou.length, outward.length, 'every approved line appears, and no others');
  for (const line of r.spokenForYou) {
    assert.ok(outward.some((m) => m.type === 'outward' && m.text === line.text));
  }
  assert.equal(r.unapprovedWords.length, 0, 'the invariant holds on the record too');
  assert.ok(r.youWereHeardSaying.some((h) => /refill/i.test(h.text)));
  assert.ok(r.spokenForYou.some((l) => l.kind === 'relay' && l.spoken), 'something was actually spoken');
  assert.ok(r.durationMs > 0);

  const text = recordAsText(r);
  assert.match(text, /What was said in Robert's name/);
  assert.match(text, /Every word the voice spoke appears in a line the rules approved/);
  // Nothing in the readable form that is not in the structured form.
  for (const line of r.spokenForYou) assert.ok(text.includes(line.text));
});

// The harder call: the caller was asked, and tapped an answer.
test('a question and the sentence it produced are both in the record', () => {
  const { events } = recorded('recorded-call-choice.json');
  const r = callRecord(events, { caller: 'Robert' });
  assert.ok(r.youWereAsked.length > 0, 'the call asked');
  const q = r.youWereAsked[0]!;
  assert.ok(q.options.length >= 2, 'a forced choice has at least two options');
  assert.match(recordAsText(r), /What you were asked/);
});

// A call where the hold line was cut off must say so: "approved and spoken" and
// "approved and cut off mid-word" are different facts about the same line.
test('a cut-off line is recorded as cut off, not as spoken', () => {
  const events = [
    { seq: 0, t: 1000, type: 'outward', kind: 'hold', text: 'One moment please.' },
    { seq: 1, t: 1500, type: 'agent_cut', texts: ['One moment please.'] },
  ] as unknown as ServerMessage[];
  const r = callRecord(events);
  assert.equal(r.spokenForYou[0]!.cutOff, true);
  assert.equal(r.spokenForYou[0]!.spoken, false);
  assert.match(recordAsText(r), /cut off when you spoke again/);
});

// If the voice ever said a word no rule approved, the record has to show it.
test('the record reports an unapproved word rather than hiding it', () => {
  const events = [
    { seq: 0, t: 0, type: 'outward', kind: 'relay', text: 'Robert says: I need a refill.' },
    { seq: 1, t: 10, type: 'agent_spoke', text: 'Robert says: I need a refill tomorrow.' },
  ] as unknown as ServerMessage[];
  const r = callRecord(events);
  assert.deepEqual(r.unapprovedWords, ['tomorrow']);
  assert.match(recordAsText(r), /FAILED: words were spoken that no rule approved: tomorrow/);
});
