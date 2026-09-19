// A complete One Moment call, headless, against the live AssemblyAI APIs.
//
// Caller: "I need to refill my ... [6 seconds] ... amlodipine prescription please."
// Pharmacist, during the pause: "Hello? Are you there?"
//
// What must happen:
//   1. The patient stream holds the caller's turn open through the 6s pause.
//   2. The pharmacist speaks mid-turn, so the Floor Controller queues a hold line.
//   3. The Voice Agent asks our endpoint what to say, and speaks the hold line.
//   4. The caller finishes. Dissent decides: relay, or ask a forced choice.
//   5. Something grounded reaches the pharmacist.
//   6. INVARIANT: every word the Voice Agent spoke is text the Adjudicator
//      approved. No exceptions. This is the product's core promise, checked
//      end to end rather than asserted.
//
// Run: npm run e2e:headless [-- --voice george]
//
// --voice proves bring-your-own-voice end to end: the id goes through the same
// path a browser's hello takes, and the far party hears that voice say the
// approved lines. Anything not in VOICES is refused before AssemblyAI sees it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isVoice, type ServerMessage } from '@one-moment/core';
import { startServer } from '../src/server.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../../../eval/fixtures');

function readPcm(file: string): { rate: number; pcm: Buffer } {
  const b = fs.readFileSync(file);
  let o = 12;
  let rate = 16000;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(o + 12);
    if (id === 'data') return { rate, pcm: b.subarray(o + 8, o + 8 + size) };
    o += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${file}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

async function main() {
  const caller = readPcm(path.join(FIX, 'caller-pause-6s.wav'));
  const hello = readPcm(path.join(FIX, 'pharmacist-hello-24k.wav'));
  if (caller.rate !== 16000 || hello.rate !== 24000) throw new Error('fixture sample rates are wrong');

  console.log('Starting orchestrator with a public tunnel (the Voice Agent needs HTTPS)...');
  const server = await startServer({ port: 8799, tunnel: true });
  console.log(`  public URL: ${server.publicUrl ?? 'NONE, far leg will be off'}`);

  const asked = process.argv[process.argv.indexOf('--voice') + 1];
  const voice = process.argv.includes('--voice') && isVoice(asked) ? asked : undefined;
  if (process.argv.includes('--voice') && !voice) throw new Error(`"${asked}" is not a voice this build offers`);
  const call = await server.createCall({ retainAudio: true, ...(voice ? { voice } : {}) });
  console.log(`  call ${call.id} started${voice ? `, speaking in ${voice}` : ''}\n`);

  // Record exactly what the Adjudicator handed the Voice Agent each time it asked.
  const approved: string[] = [];
  const original = call.takeApprovedSpeech.bind(call);
  call.takeApprovedSpeech = () => {
    const t = original();
    if (t) approved.push(t);
    return t;
  };

  const msgs: ServerMessage[] = [];
  const T0 = Date.now();
  const at = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(5) + 's';
  call.on('message', (m) => {
    msgs.push(m);
    switch (m.type) {
      case 'turn':
        if (m.turn.end_of_turn) console.log(`${at()}  ${m.stream.padEnd(7)} FINAL  "${m.turn.transcript}"`);
        break;
      case 'floor': console.log(`${at()}  floor   ${m.state}`); break;
      case 'far_heard': console.log(`${at()}  PHARMACIST said: "${m.text}"`); break;
      case 'outward': console.log(`${at()}  APPROVED -> agent (${m.kind}): "${m.text}"`); break;
      case 'dissent':
        console.log(`${at()}  DISSENT  advocate="${m.result.advocate?.say ?? '-'}"`);
        console.log(`${' '.repeat(8)}         skeptic ="${m.result.skeptic?.reading ?? '-'}"`);
        console.log(`${' '.repeat(8)}         decision=${m.result.decision.action} rule ${m.result.decision.policyRule} (${m.result.decision.reason})  ${m.result.timings.totalMs}ms`);
        break;
      case 'question':
        console.log(`${at()}  QUESTION to caller: "${m.question.prompt}"  [${m.question.options.map((o) => o.label).join(' | ')}]`);
        setTimeout(() => { console.log(`${at()}  caller taps "${m.question.options[0]!.label}"`); call.choose(m.question.id, m.question.options[0]!.id); }, 1500);
        break;
      case 'cue': console.log(`${at()}  cue to caller: "${m.text}"`); break;
      case 'escalated': console.log(`${at()}  ESCALATED: ${m.reason}`); break;
      case 'log': console.log(`${at()}  log     ${m.message}`); break;
    }
  });

  const spoken: string[] = [];
  const agentTextListener = (m: ServerMessage) => void m;
  void agentTextListener;
  // The Voice Agent's own transcript of what it said, straight from AssemblyAI.
  const pushSpoken = () => {
    for (const x of call.transcript) if (x.speaker === 'agent' && !spoken.includes(x.text)) {
      spoken.push(x.text);
      console.log(`${at()}  VOICE AGENT SPOKE: "${x.text}"`);
    }
  };
  const poll = setInterval(pushSpoken, 200);

  // ---- drive both parties in real time ----------------------------------------
  const CALLER_FRAME = 1600;  // 50ms at 16kHz
  const FAR_FRAME = 2400;     // 50ms at 24kHz
  const HELLO_AT_MS = 3300;   // during the caller's 6s word-finding pause
  const TOTAL_MS = 34000;

  const callerSilence = Buffer.alloc(CALLER_FRAME);
  const farSilence = Buffer.alloc(FAR_FRAME);
  const start = Date.now();
  for (let i = 0; i * 50 < TOTAL_MS; i++) {
    const due = start + i * 50;
    const wait = due - Date.now();
    if (wait > 0) await sleep(wait);
    const ms = i * 50;

    const c = caller.pcm.subarray(i * CALLER_FRAME, (i + 1) * CALLER_FRAME);
    call.callerFrame(c.length === CALLER_FRAME ? c : callerSilence);

    const hi = Math.floor((ms - HELLO_AT_MS) / 50);
    const h = hi >= 0 ? hello.pcm.subarray(hi * FAR_FRAME, (hi + 1) * FAR_FRAME) : Buffer.alloc(0);
    call.farFrame(h.length === FAR_FRAME ? h : farSilence);
  }

  await sleep(3000);
  pushSpoken();
  clearInterval(poll);

  // ---- verdict ----------------------------------------------------------------
  const patientFinals = msgs.filter((m) => m.type === 'turn' && m.stream === 'patient' && m.turn.end_of_turn);
  const holds = msgs.filter((m) => m.type === 'outward' && m.kind === 'hold');
  const relays = msgs.filter((m) => m.type === 'outward' && m.kind === 'relay');
  const dissents = msgs.filter((m) => m.type === 'dissent');
  const approvedNorm = approved.map(norm);
  const unapproved = spoken.filter((s) => !approvedNorm.some((a) => a === norm(s) || a.includes(norm(s))));

  const firstFinal = patientFinals[0];
  const heldWholeSentence = !!firstFinal && firstFinal.type === 'turn' && /refill/i.test(firstFinal.turn.transcript) && /amlodipine/i.test(firstFinal.turn.transcript);

  console.log('\n==================== VERDICT ====================');
  const row = (ok: boolean, label: string, detail = '') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  row(heldWholeSentence, 'patient stream held the caller\'s turn through the 6s pause', firstFinal && firstFinal.type === 'turn' ? `"${firstFinal.turn.transcript}"` : 'no final');
  row(holds.length > 0, 'a hold line was approved while the caller was mid-turn');
  row(spoken.some((s) => /moment|with you|finding the word|not finished/i.test(s)), 'the Voice Agent actually spoke the hold line');
  row(dissents.length > 0, 'Dissent ran on the finished turn');
  row(relays.length > 0, 'something grounded was relayed to the pharmacist');
  row(spoken.length > 0 && unapproved.length === 0, 'INVARIANT: every word the Voice Agent spoke was approved text',
    unapproved.length ? `unapproved: ${JSON.stringify(unapproved)}` : `${spoken.length} utterances, all approved`);

  fs.mkdirSync(path.resolve(here, '../../../eval/results'), { recursive: true });
  const out = path.resolve(here, '../../../eval/results', `headless-call-${call.id}.json`);
  fs.writeFileSync(out, JSON.stringify({ callId: call.id, approved, spoken, events: call.history }, null, 2));
  console.log(`\n  full event log: ${path.relative(process.cwd(), out)}`);

  await call.end();
  await server.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
