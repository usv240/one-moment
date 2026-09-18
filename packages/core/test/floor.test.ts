import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleEvidence, DEFAULT_FLOOR_CONFIG, firstHoldLine, holdLines, initialFloor, stepFloor,
  type DissentResult, type FloorAction, type FloorEvent, type FloorModel, type ForcedChoice,
} from '../src/index.ts';
import { turn } from './fixtures.ts';

const cfg = { ...DEFAULT_FLOOR_CONFIG, userName: 'Robert', pronoun: 'he' as const };

function run(events: FloorEvent[], start: FloorModel = initialFloor()) {
  let m = start;
  const actions: FloorAction[] = [];
  for (const e of events) {
    const r = stepFloor(m, e, cfg);
    m = r.model;
    actions.push(...r.actions);
  }
  return { m, actions };
}

const said = (a: FloorAction[], kind?: string) =>
  a.filter((x): x is Extract<FloorAction, { type: 'say_far' }> => x.type === 'say_far' && (!kind || x.kind === kind));

const ask = (rule = 2): DissentResult => ({
  advocate: null, skeptic: null,
  deterministic: { negationInEvidence: false, negationDisputed: false, invented: ['x'], polarityMismatch: false },
  decision: { action: 'ask', policyRule: rule, reason: 'test' },
  timings: { advocateMs: 0, skepticMs: 0, totalMs: 0 }, model: 'm',
});
const q: ForcedChoice = { id: 'q1', prompt: 'A new one, or stop it?', options: [{ id: 'a', label: 'A new one' }, { id: 'b', label: 'Stop it' }], allowSomethingElse: true };

test('the product in one transition: the far party speaks mid-turn and we hold the floor', () => {
  const { m, actions } = run([
    { type: 'user_speech', at: 1000 },
    { type: 'far_speech', at: 4000 },
  ]);
  assert.equal(m.state, 'HOLDING');
  const first = said(actions)[0]!;
  assert.equal(first.kind, 'hold', 'the words that make the far party wait come first');
  assert.equal(first.text, "One moment please, he's still with you. I'm his assistant.");
  assert.equal(first.discloses, true, 'and the same line discloses the assistant');
  assert.equal(said(actions).length, 1, 'one short line, not a disclosure followed by a hold');
});

test('the assistant discloses itself exactly once per call', () => {
  const { actions } = run([
    { type: 'user_speech', at: 0 },
    { type: 'far_speech', at: 3000 },
    { type: 'far_speech', at: 10000 },
    { type: 'far_speech', at: 20000 },
  ]);
  assert.equal(said(actions).filter((a) => a.discloses).length, 1);
  assert.equal(said(actions).filter((a) => /assistant/.test(a.text)).length, 1);
});

test('a relay with no hold before it is still preceded by a disclosure', () => {
  const { actions } = run([
    { type: 'user_speech', at: 0 },
    { type: 'user_turn_final', at: 8000, evidence: assembleEvidence({ patient: turn('I need my tablets.') }) },
    { type: 'dissent', at: 8100, result: { ...ask(), decision: { action: 'relay', text: 'Robert says: I need my tablets.', policyRule: 9, reason: 'verbatim' } } },
  ]);
  const out = said(actions);
  assert.equal(out[0]!.kind, 'disclosure');
  assert.equal(out[0]!.discloses, true);
  assert.equal(out[1]!.kind, 'relay');
});

test('hold lines rotate and respect a cooldown, so we never talk over the far party', () => {
  const { actions } = run([
    { type: 'user_speech', at: 0 },
    { type: 'far_speech', at: 3000 },
    { type: 'far_speech', at: 4000 },
    { type: 'far_speech', at: 10000 },
  ]);
  const holds = said(actions, 'hold').map((x) => x.text);
  assert.equal(holds.length, 2, 'the one at +1s is suppressed by the cooldown');
  assert.notEqual(holds[0], holds[1]);
  assert.deepEqual(holds, [firstHoldLine(cfg), holdLines(cfg)[1]]);
});

test('a hold cut off by the caller resuming hands the floor back and re-arms the disclosure', () => {
  const { m, actions } = run([
    { type: 'user_speech', at: 0 },
    { type: 'far_speech', at: 3000 },
    { type: 'outward_cut', at: 5000, disclosureLost: true },
    { type: 'user_turn_final', at: 9000, evidence: assembleEvidence({ patient: turn('I need my tablets.') }) },
    { type: 'dissent', at: 9100, result: { ...ask(), decision: { action: 'relay', text: 'Robert says: I need my tablets.', policyRule: 9, reason: 'verbatim' } } },
  ]);
  assert.equal(m.state, 'RELAYING');
  const out = said(actions);
  assert.equal(out.filter((a) => a.discloses).length, 2, 'the cut disclosure is said again before the relay');
  assert.equal(out.at(-2)!.kind, 'disclosure');
  assert.equal(out.at(-1)!.kind, 'relay');
});

test('no hold when the user is not mid-turn: the far party is simply speaking', () => {
  const { m, actions } = run([{ type: 'far_speech', at: 1000 }]);
  assert.equal(m.state, 'FAR_SPEAKING');
  assert.equal(said(actions).length, 0);
});

test('a finished user turn triggers Dissent, never an immediate relay', () => {
  const { m, actions } = run([
    { type: 'user_speech', at: 0 },
    { type: 'user_turn_final', at: 8000, evidence: assembleEvidence({ patient: turn('I need my tablets') }) },
  ]);
  assert.equal(m.state, 'DECIDING');
  assert.ok(actions.some((a) => a.type === 'run_dissent'));
  assert.equal(said(actions, 'relay').length, 0);
});

test('an ask becomes a forced choice, and the chosen label is what gets relayed', () => {
  const { m, actions } = run([
    { type: 'user_speech', at: 0 },
    { type: 'user_turn_final', at: 5000, evidence: assembleEvidence({ patient: turn('refill') }) },
    { type: 'dissent', at: 5300, result: ask(), question: q },
    { type: 'choice', at: 9000, label: 'Stop it' },
  ]);
  assert.ok(actions.some((a) => a.type === 'ask_user'));
  assert.equal(said(actions, 'relay')[0]!.text, 'Stop it');
  assert.equal(m.stats.inventionsBlocked, 1);
  assert.equal(m.state, 'RELAYING');
});

test('three unresolved turns hand the call to a human instead of looping', () => {
  const evs: FloorEvent[] = [];
  for (let i = 0; i < 3; i++) {
    evs.push({ type: 'user_speech', at: i * 10000 });
    evs.push({ type: 'user_turn_final', at: i * 10000 + 3000, evidence: assembleEvidence({ patient: turn('um') }) });
    evs.push({ type: 'dissent', at: i * 10000 + 3300, result: ask(6), question: q });
    evs.push({ type: 'something_else', at: i * 10000 + 5000 });
  }
  const { m, actions } = run(evs);
  assert.equal(m.state, 'ESCALATE');
  assert.ok(actions.some((a) => a.type === 'escalate'));
});

test('Stop always cancels speech made in the user\'s name', () => {
  const start = run([
    { type: 'user_speech', at: 0 },
    { type: 'user_turn_final', at: 3000, evidence: assembleEvidence({ patient: turn('refill') }) },
    { type: 'dissent', at: 3300, result: ask(), question: q },
    { type: 'choice', at: 5000, label: 'A new one' },
  ]).m;
  const { actions } = run([{ type: 'stop', at: 5100 }], start);
  assert.ok(actions.some((a) => a.type === 'cancel_outward'));
});

test('the user never gets a countdown: one gentle cue, once', () => {
  const { actions } = run([
    { type: 'user_speech', at: 0 },
    { type: 'tick', at: 9000 },
    { type: 'tick', at: 15000 },
    { type: 'tick', at: 30000 },
  ]);
  const cues = actions.filter((a) => a.type === 'cue_user');
  assert.equal(cues.length, 1);
  assert.equal((cues[0] as { text: string }).text, 'Take your time.');
});
