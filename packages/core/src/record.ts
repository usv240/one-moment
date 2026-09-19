// What was said in your name: the record a call leaves behind.
//
// A relay call is the one conversation where the person it is about cannot
// check what was said for them. They heard their own side; they did not hear
// the sentence the agent chose, and they cannot replay a phone call. So when
// the call ends the system owes them a record: every line spoken on their
// behalf, whether it was actually spoken or cut off, every question they were
// asked and what they chose, and the post-call audit's verdict on each relay.
//
// It is also the thing a pharmacy, a clinician or a family member can be shown
// when a call is disputed, and the thing a human relay assistant reads when a
// call is handed over.
//
// Built from the call's own event log, which is the same log the replay is
// built from, so the record cannot say something the call did not produce.

import type { CallAudit, ServerMessage } from './protocol.ts';

export type CallRecord = {
  callId: string;
  caller: string;
  /** ISO 8601, if the log carries a wall-clock start. */
  startedAt: string | null;
  durationMs: number;
  /** Every line the agent was approved to say, in order, with what became of it. */
  spokenForYou: { atMs: number; kind: 'disclosure' | 'hold' | 'relay'; text: string; spoken: boolean; cutOff: boolean }[];
  /** What the patient ear heard the caller say, turn by turn. */
  youWereHeardSaying: { atMs: number; text: string }[];
  /** Every forced choice, and which option was relayed as a result. */
  youWereAsked: { atMs: number; prompt: string; options: string[]; chosen: string | null }[];
  /** What the other party said, as the Voice Agent heard it. */
  otherPersonSaid: { atMs: number; text: string }[];
  /** Turns where the rules declined to speak, with the rule that decided. */
  notSpoken: { atMs: number; rule: number; reason: string }[];
  audit: CallAudit | null;
  /** The invariant, recomputed here rather than trusted: words spoken that were never approved. */
  unapprovedWords: string[];
};

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function callRecord(events: ServerMessage[], meta: { callId?: string; caller?: string; startedAt?: string } = {}): CallRecord {
  const ready = events.find((m) => m.type === 'ready');
  const start = events[0]?.t ?? 0;
  const at = (t: number) => Math.max(0, t - start);

  const spokenForYou: CallRecord['spokenForYou'] = [];
  const youWereHeardSaying: CallRecord['youWereHeardSaying'] = [];
  const youWereAsked: CallRecord['youWereAsked'] = [];
  const otherPersonSaid: CallRecord['otherPersonSaid'] = [];
  const notSpoken: CallRecord['notSpoken'] = [];
  const saidAloud: string[] = [];
  let audit: CallAudit | null = null;

  for (const m of events) {
    switch (m.type) {
      case 'outward':
        spokenForYou.push({ atMs: at(m.t), kind: m.kind, text: m.text, spoken: false, cutOff: false });
        break;
      case 'agent_spoke': {
        saidAloud.push(m.text);
        const said = norm(m.text);
        for (const line of spokenForYou) if (!line.cutOff && said.includes(norm(line.text))) line.spoken = true;
        break;
      }
      case 'agent_cut':
        for (const line of spokenForYou) if (m.texts.includes(line.text)) { line.cutOff = true; line.spoken = false; }
        break;
      case 'turn':
        if (m.stream === 'patient' && m.turn.end_of_turn && m.turn.transcript) {
          youWereHeardSaying.push({ atMs: at(m.t), text: m.turn.transcript });
        }
        break;
      case 'question':
        youWereAsked.push({ atMs: at(m.t), prompt: m.question.prompt, options: m.question.options.map((o) => o.label), chosen: null });
        break;
      case 'far_heard':
        otherPersonSaid.push({ atMs: at(m.t), text: m.text });
        break;
      case 'dissent':
        if (m.result.decision.action !== 'relay') {
          notSpoken.push({ atMs: at(m.t), rule: m.result.decision.policyRule, reason: m.result.decision.reason });
        }
        break;
      case 'audit':
        audit = m.audit;
        break;
      default:
        break;
    }
  }

  // A relay that follows a question is the answer to it: the caller's own choice,
  // in the words the far party heard.
  for (const q of youWereAsked) {
    const answer = spokenForYou.find((l) => l.kind === 'relay' && l.atMs > q.atMs);
    if (answer) q.chosen = answer.text;
  }

  const approved = new Set(spokenForYou.flatMap((l) => norm(l.text).split(' ')));
  const unapprovedWords = [...new Set(saidAloud.flatMap((s) => norm(s).split(' ').filter((w) => w && !approved.has(w))))];

  return {
    callId: meta.callId ?? ready?.callId ?? 'unknown',
    caller: meta.caller ?? ready?.caller ?? 'The caller',
    startedAt: meta.startedAt ?? null,
    durationMs: at(events[events.length - 1]?.t ?? start),
    spokenForYou,
    youWereHeardSaying,
    youWereAsked,
    otherPersonSaid,
    notSpoken,
    audit,
    unapprovedWords,
  };
}

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

/** The same record as something a person can read, print or hand to a pharmacist. */
export function recordAsText(r: CallRecord): string {
  const lines: string[] = [];
  const add = (s = '') => lines.push(s);

  add(`What was said in ${r.caller}'s name`);
  add('='.repeat(`What was said in ${r.caller}'s name`.length));
  add();
  add(`Call ${r.callId}${r.startedAt ? `, ${r.startedAt}` : ''}, ${clock(r.durationMs)} long.`);
  add('Produced by One Moment from the call\'s own event log. Not a medical record.');
  add();

  add('Spoken for you');
  add('--------------');
  if (!r.spokenForYou.length) add('Nothing was ever spoken in your name on this call.');
  for (const l of r.spokenForYou) {
    const state = l.cutOff ? 'cut off when you spoke again' : l.spoken ? 'spoken in full' : 'approved, never spoken';
    add(`  ${clock(l.atMs)}  [${l.kind}, ${state}]`);
    add(`         "${l.text}"`);
  }
  add();

  add('What the listening ear heard you say');
  add('-----------------------------------');
  for (const h of r.youWereHeardSaying) add(`  ${clock(h.atMs)}  "${h.text}"`);
  if (!r.youWereHeardSaying.length) add('  nothing recorded');
  add();

  if (r.youWereAsked.length) {
    add('What you were asked, and what went out as a result');
    add('-------------------------------------------------');
    for (const q of r.youWereAsked) {
      add(`  ${clock(q.atMs)}  "${q.prompt}"  (${q.options.join(' / ')})`);
      add(`         went out as: ${q.chosen ? `"${q.chosen}"` : 'nothing'}`);
    }
    add();
  }

  if (r.notSpoken.length) {
    add('Turns where it chose not to speak for you');
    add('----------------------------------------');
    for (const n of r.notSpoken) add(`  ${clock(n.atMs)}  rule ${n.rule}: ${n.reason}`);
    add();
  }

  if (r.otherPersonSaid.length) {
    add('What the other person said');
    add('--------------------------');
    for (const f of r.otherPersonSaid) add(`  ${clock(f.atMs)}  "${f.text}"`);
    add();
  }

  add('The check on the call');
  add('---------------------');
  if (r.audit) {
    add(`After the call, ${r.audit.model} transcribed your audio again, more carefully than a live`);
    add('stream can, and every relayed word was checked against it.');
    add();
    for (const rel of r.audit.relays) {
      // Recordings made before the audit tracked choices have no byChoice field.
      const byChoice = rel.byChoice ?? [];
      const missing = rel.missing ?? [];
      add(`  "${rel.said}"`);
      add(`      ${rel.confirmed ? 'every word confirmed' : `not confirmed: ${missing.join(', ')}`}${byChoice.length ? ` (${byChoice.join(', ')} confirmed by your own choice)` : ''}`);
    }
    add();
    add(`  Verdict: ${r.audit.verdict}`);
  } else {
    add('No audit ran on this call, because your audio was not kept. That is the default.');
  }
  add();

  add('The guarantee, rechecked on this record');
  add('---------------------------------------');
  add(r.unapprovedWords.length
    ? `  FAILED: words were spoken that no rule approved: ${r.unapprovedWords.join(', ')}`
    : '  Every word the voice spoke appears in a line the rules approved. It has no other source of words.');
  add();
  add('If anything here is not what you meant, it can be disputed with this record in hand.');

  return `${lines.join('\n')}\n`;
}
