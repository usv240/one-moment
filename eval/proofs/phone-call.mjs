// Proof: One Moment answers a real phone call.
//
// Twilio Media Streams is a documented WebSocket protocol, so the phone leg can
// be proven without a phone: this speaks Twilio's side of it exactly as Twilio
// does. It dials in, streams Robert's recorded sentence as 20ms frames of 8kHz
// mu-law, and listens to what comes back down the line.
//
// Everything past the socket is the product, live: both AssemblyAI listening
// streams, the Floor Controller, the Adjudicator, and the Voice Agent speaking
// to the far party. The only thing simulated here is the telephone network.
//
// What must be true:
//   1. the caller's turn survives the 6-second pause, on 8kHz telephone audio
//   2. something grounded is relayed for him
//   3. audio comes back down the line, so the caller can actually hear the call
//   4. INVARIANT: every word spoken was text the Adjudicator approved
//
//   node --env-file=.env eval/proofs/phone-call.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startServer } from '../../apps/orchestrator/src/server.ts';
import { pcmToMulaw, resample } from '../../apps/orchestrator/src/audio-codec.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../fixtures');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readPcm(file) {
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

const caller = readPcm(path.join(FIX, 'caller-pause-6s.wav'));
// What the telephone network would do to it: 16kHz PCM16 down to 8kHz mu-law.
const line = pcmToMulaw(resample(caller.pcm, caller.rate, 8000));
console.log(`caller audio: ${(caller.pcm.length / 2 / caller.rate).toFixed(1)}s, ${line.length} bytes on the line`);

console.log('starting the orchestrator with a public tunnel (the Voice Agent needs HTTPS)...');
const server = await startServer({ port: 8803, tunnel: true });
console.log(`  public URL: ${server.publicUrl ?? 'NONE, far leg will be off'}`);

// What Twilio would fetch when a call arrives.
const twiml = await (await fetch(`http://localhost:${server.port}/twilio/voice`, { method: 'POST' })).text();
console.log(`  TwiML: ${twiml}`);
if (!/<Connect><Stream url="wss?:\/\/[^"]+\/twilio\/stream"\/><\/Connect>/.test(twiml)) {
  throw new Error('TwiML does not connect the call to the phone leg');
}

const ws = new WebSocket(`ws://localhost:${server.port}/twilio/stream`);
const back = [];
let approved = [];
let spoken = [];
ws.on('message', (raw) => {
  const ev = JSON.parse(String(raw));
  if (ev.event === 'media') back.push(Buffer.from(ev.media.payload, 'base64'));
});
await new Promise((r) => ws.once('open', r));

// Twilio's opening handshake, then 20ms of mu-law every 20ms, in real time.
ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
ws.send(JSON.stringify({ event: 'start', streamSid: 'MZproof', start: { callSid: 'CAproof' } }));

// Find the call this socket created, so the proof can read its decisions.
await sleep(1500);
const call = [...server.calls.values()].at(-1);
if (!call) throw new Error('the phone leg did not create a call');
call.on('message', (m) => {
  if (m.type === 'outward') approved.push(m.text);
  if (m.type === 'agent_spoke') spoken.push(m.text);
  if (m.type === 'turn' && m.stream === 'patient' && m.turn.end_of_turn && m.turn.transcript) {
    console.log(`  ${(m.t / 1000).toFixed(1)}s patient FINAL "${m.turn.transcript}"`);
  }
  if (m.type === 'dissent') console.log(`  ${(m.t / 1000).toFixed(1)}s DECIDED ${m.result.decision.action} rule ${m.result.decision.policyRule}`);
  if (m.type === 'outward') console.log(`  ${(m.t / 1000).toFixed(1)}s APPROVED (${m.kind}) "${m.text}"`);
  if (m.type === 'agent_spoke') console.log(`  ${(m.t / 1000).toFixed(1)}s SPOKEN "${m.text}"`);
});

const FRAME = 160; // 20ms of 8kHz mu-law
const t0 = Date.now();
for (let i = 0, tick = 0; i < line.length; i += FRAME, tick++) {
  const f = line.subarray(i, i + FRAME);
  ws.send(JSON.stringify({ event: 'media', media: { payload: (f.length === FRAME ? f : Buffer.concat([f, Buffer.alloc(FRAME - f.length, 0xff)])).toString('base64') } }));
  const due = t0 + tick * 20;
  const wait = due - Date.now();
  if (wait > 0) await sleep(wait);
}
// Silence on the line while the turn finishes and the agent replies.
for (let tick = 0; tick < 500; tick++) {
  ws.send(JSON.stringify({ event: 'media', media: { payload: Buffer.alloc(FRAME, 0xff).toString('base64') } }));
  await sleep(20);
}
ws.send(JSON.stringify({ event: 'stop' }));
await sleep(1500);
ws.close();

const patient = call.history.filter((m) => m.type === 'turn' && m.stream === 'patient' && m.turn.end_of_turn && m.turn.transcript);
const held = patient.length === 1 && /amlodipine|refill/i.test(patient[0].turn.transcript);
const relay = approved.find((t) => /says:|saying/i.test(t)) ?? null;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const approvedWords = new Set(approved.flatMap((t) => norm(t).split(' ')));
const unapproved = spoken.flatMap((s) => norm(s).split(' ').filter((w) => w && !approvedWords.has(w)));
const secondsBack = (back.reduce((n, b) => n + b.length, 0) / 8000).toFixed(1);

const results = [
  ['the turn survived the 6-second pause on telephone audio', held, patient.map((m) => `"${m.turn.transcript}"`).join(' / ')],
  ['something grounded was relayed for the caller', Boolean(relay), relay ?? 'nothing relayed'],
  ['audio came back down the line', back.length > 0, `${back.length} frames, ${secondsBack}s of 8kHz mu-law`],
  ['INVARIANT: every word spoken was approved text', unapproved.length === 0, `${spoken.length} utterances, ${unapproved.length} unapproved`],
];
console.log('\n==================== VERDICT ====================');
for (const [what, ok, detail] of results) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}  (${detail})`);

await server.close();
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
