// Records one complete sample call, exactly as a judge's browser receives it,
// for the replay on the website. The replay must work when the live engine is
// down, and it must be a real call rather than a mock-up, so this captures:
//
//   - every stamped server event, unmodified, and
//   - every audio frame on all three channels (caller, pharmacist, agent),
//     mixed into one track on the call's own clock.
//
// Audio placement mirrors the browser's Player: each channel has a playhead,
// and a chunk plays at max(arrival, end of the previous chunk). The Voice
// Agent streams its speech faster than real time, so without this the agent
// would sound sped up.
//
// Output:
//   apps/web/src/content/recorded-call.json   { recordedAt, events }
//   apps/web/public/recorded/robert-call.mp3  mixed audio, t=0 is call time 0
//
// Usage: node --env-file=.env apps/orchestrator/scripts/record-sample-call.ts [choice|dissent]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type { Scenario, ServerMessage } from '@one-moment/core';
import { startServer } from '../src/server.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../../web');
const RATE = 24000;
const CH_RATE: Record<number, number> = { 1: 16000, 2: 24000, 3: 24000 };
const SCENARIO: Scenario = process.argv.includes('dissent') ? 'dissent' : process.argv.includes('choice') ? 'choice' : 'pause';
const SUFFIX = SCENARIO === 'pause' ? '' : `-${SCENARIO}`;

const server = await startServer({ port: 8799, tunnel: true });
console.log(`server up, public URL ${server.publicUrl ?? 'none'}`);
if (!server.publicUrl) console.log('WARNING: no public URL, so no Voice Agent. The recording will use the browser fallback.');

const events: ServerMessage[] = [];
const chunks: { ch: number; at: number; pcm: Buffer }[] = [];
const playhead: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
let offset: number | null = null; // wall clock minus call clock
let done = false;
let graded = false;

const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', role: 'caller', mode: 'sample', scenario: SCENARIO })));
ws.on('message', (data, isBinary) => {
  const now = Date.now();
  if (isBinary) {
    if (offset === null) return;
    const b = data as Buffer;
    const ch = b[0]!;
    const pcm = b.subarray(1);
    const arrival = now - offset;
    const at = Math.max(arrival, playhead[ch] ?? 0);
    playhead[ch] = at + (pcm.length / 2 / CH_RATE[ch]!) * 1000;
    chunks.push({ ch, at, pcm: Buffer.from(pcm) });
    return;
  }
  const m = JSON.parse(String(data)) as ServerMessage;
  if (m.type === 'ready') offset = now - m.t;
  // Mirror the browser's flush: agent audio scheduled after the cut is never heard.
  if (m.type === 'agent_cut') {
    const cutAt = m.t;
    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i]!;
      if (c.ch !== 3) continue;
      const dur = (c.pcm.length / 2 / CH_RATE[3]!) * 1000;
      if (c.at >= cutAt) chunks.splice(i, 1);
      else if (c.at + dur > cutAt) c.pcm = c.pcm.subarray(0, Math.floor(((cutAt - c.at) / 1000) * CH_RATE[3]!) * 2);
    }
    playhead[3] = cutAt;
    console.log(`${(m.t / 1000).toFixed(1).padStart(5)}s CUT "${m.texts.join(' ')}"`);
  }
  events.push(m);
  if (m.type === 'simulation') console.log(`${(m.t / 1000).toFixed(1).padStart(5)}s SIM ${m.event}`);
  if (m.type === 'outward') console.log(`${(m.t / 1000).toFixed(1).padStart(5)}s APPROVED (${m.kind}) "${m.text}"`);
  if (m.type === 'agent_spoke') console.log(`${(m.t / 1000).toFixed(1).padStart(5)}s SPOKEN "${m.text}"`);
  if (m.type === 'floor' && m.state !== 'USER_SPEAKING') console.log(`${(m.t / 1000).toFixed(1).padStart(5)}s floor ${m.state}`);
  if (m.type === 'log') console.log(`${(m.t / 1000).toFixed(1).padStart(5)}s log ${m.message}`);
  if (m.type === 'question') console.log(`${(m.t / 1000).toFixed(1).padStart(5)}s QUESTION "${m.question.prompt}" ${m.question.options.map((o) => o.label).join(' | ')}`);
  if (m.type === 'dissent') console.log(`${(m.t / 1000).toFixed(1).padStart(5)}s DECIDED ${m.result.decision.action} rule ${m.result.decision.policyRule}`);
  if (m.type === 'simulation' && m.event === 'call_complete') done = true;
  if (m.type === 'audit' || m.type === 'audit_failed') {
    graded = true;
    console.log(`${(m.t / 1000).toFixed(1).padStart(5)}s AUDIT ${m.type === 'audit' ? `${m.audit.verdict} careful pause ${m.audit.pause.carefulMs}ms, live gap ${m.audit.pause.liveGapMs}ms, estimate ${m.audit.pause.estimatedMs}ms` : m.message}`);
  }
});

const deadline = Date.now() + 75000;
while (!done && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
// The self-audit starts at call_complete. Keep the recording running until it lands.
const gradeDeadline = Date.now() + 40000;
while (done && !graded && Date.now() < gradeDeadline) await new Promise((r) => setTimeout(r, 250));
// Let the last agent audio finish arriving.
await new Promise((r) => setTimeout(r, 2500));
ws.close();
await server.close();

if (!done) {
  console.log('DID NOT COMPLETE. Nothing written.');
  process.exit(1);
}

// ---- mix ----------------------------------------------------------------
const endMs = Math.max(...chunks.map((c) => c.at + (c.pcm.length / 2 / CH_RATE[c.ch]!) * 1000), events.at(-1)!.t) + 500;
const mix = new Float32Array(Math.ceil((endMs / 1000) * RATE));
const GAIN: Record<number, number> = { 1: 0.9, 2: 0.9, 3: 0.9 };
for (const c of chunks) {
  const srcRate = CH_RATE[c.ch]!;
  const n = c.pcm.length / 2;
  const start = Math.round((c.at / 1000) * RATE);
  const outN = Math.floor((n * RATE) / srcRate);
  for (let i = 0; i < outN; i++) {
    const pos = (i * srcRate) / RATE;
    const i0 = Math.floor(pos);
    const i1 = Math.min(n - 1, i0 + 1);
    const f = pos - i0;
    const s = (c.pcm.readInt16LE(i0 * 2) * (1 - f) + c.pcm.readInt16LE(i1 * 2) * f) / 32768;
    const k = start + i;
    if (k < mix.length) mix[k]! += s * GAIN[c.ch]!;
  }
}
const pcm = Buffer.alloc(mix.length * 2);
for (let i = 0; i < mix.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mix[i]! * 32767))), i * 2);

const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write('data', 36); header.writeUInt32LE(pcm.length, 40);

const audioDir = path.join(WEB, 'public', 'recorded');
fs.mkdirSync(audioDir, { recursive: true });
const tmp = path.join(audioDir, `robert-call${SUFFIX}.wav`);
fs.writeFileSync(tmp, Buffer.concat([header, pcm]));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-codec:a', 'libmp3lame', '-b:a', '64k', path.join(audioDir, `robert-call${SUFFIX}.mp3`)]);
fs.rmSync(tmp);

const out = path.join(WEB, 'src', 'content', `recorded-call${SUFFIX}.json`);
fs.writeFileSync(out, JSON.stringify({ recordedAt: new Date().toISOString(), durationMs: Math.round(endMs), events }, null, 0));

const secs = (ch: number) => (chunks.filter((c) => c.ch === ch).reduce((s, c) => s + c.pcm.length / 2, 0) / CH_RATE[ch]!).toFixed(1);
console.log(`\naudio: caller ${secs(1)}s, pharmacist ${secs(2)}s, agent ${secs(3)}s, total ${(endMs / 1000).toFixed(1)}s`);
console.log(`wrote ${path.relative(process.cwd(), out)} (${events.length} events)`);
console.log(`wrote ${path.relative(process.cwd(), path.join(audioDir, `robert-call${SUFFIX}.mp3`))}`);
process.exit(0);
