// Regenerates the demo's simulated voices with AssemblyAI's own text to speech,
// replacing the robotic Windows SAPI fixtures (make-fixtures.mjs, kept as a
// fallback that needs no network).
//
// Method: a stored Voice Agent's `greeting` is "sent straight to TTS" on
// connect. So create an agent whose greeting is the line, open a session,
// collect reply.audio until reply.done, close, delete the agent. 24kHz PCM16.
//
// The caller fixture keeps its defining property exactly: the two halves of
// Robert's sentence are separated by 6000ms of true digital silence, after
// trimming whatever silence the TTS put around each half.
//
// Usage: node --env-file=.env eval/make-natural-fixtures.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'fixtures');
const key = process.env.ASSEMBLYAI_API_KEY;
if (!key) throw new Error('ASSEMBLYAI_API_KEY is not set');

const REST = 'https://agents.assemblyai.com/v1/agents';
const RATE = 24000;

async function tts(text, voice) {
  const res = await fetch(REST, {
    method: 'POST',
    headers: { Authorization: key, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `om-fixture-${Date.now()}`,
      system_prompt: 'Say nothing beyond the greeting.',
      voice: { voice_id: voice },
      greeting: text,
    }),
  });
  const agent = await res.json();
  if (!res.ok || !agent.id) throw new Error(`create failed ${res.status}: ${JSON.stringify(agent).slice(0, 200)}`);
  try {
    return await new Promise((resolve, reject) => {
      const chunks = [];
      let spoken = '';
      const ws = new WebSocket('wss://agents.assemblyai.com/v1/ws', { headers: { Authorization: `Bearer ${key}` } });
      const timer = setTimeout(() => { ws.close(); reject(new Error(`timeout on "${text}"`)); }, 30000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'session.update', session: { agent_id: agent.id } })));
      ws.on('message', (raw) => {
        const ev = JSON.parse(raw.toString());
        if (ev.type === 'reply.audio') chunks.push(Buffer.from(ev.data, 'base64'));
        else if (ev.type === 'transcript.agent') spoken = ev.text ?? spoken;
        else if (ev.type === 'reply.done') {
          clearTimeout(timer);
          ws.close();
          resolve({ pcm: Buffer.concat(chunks), spoken });
        } else if (ev.type === 'error') {
          clearTimeout(timer);
          ws.close();
          reject(new Error(JSON.stringify(ev).slice(0, 200)));
        }
      });
      ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
  } finally {
    await fetch(`${REST}/${agent.id}`, { method: 'DELETE', headers: { Authorization: key } }).catch(() => {});
  }
}

/** Trim leading and trailing near-silence (|x| below threshold for the whole 10ms window). */
function trim(pcm, threshold = 350) {
  const win = (RATE / 100) * 2;
  const loud = (o) => {
    for (let i = o; i < Math.min(o + win, pcm.length); i += 2) if (Math.abs(pcm.readInt16LE(i)) > threshold) return true;
    return false;
  };
  let a = 0;
  while (a < pcm.length && !loud(a)) a += win;
  let b = pcm.length - win;
  while (b > a && !loud(b)) b -= win;
  // Keep 40ms either side so consonants are not clipped.
  const pad = (RATE / 1000) * 40 * 2;
  return pcm.subarray(Math.max(0, a - pad), Math.min(pcm.length, b + win + pad));
}

const silence = (ms, rate = RATE) => Buffer.alloc(Math.round((rate * ms) / 1000) * 2);

function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function save(name, pcm24, { to16k = false } = {}) {
  const out = path.join(dir, `${name}.wav`);
  if (!to16k) {
    fs.writeFileSync(out, wav(pcm24, RATE));
  } else {
    const tmp = path.join(dir, `${name}.24k.tmp.wav`);
    fs.writeFileSync(tmp, wav(pcm24, RATE));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out]);
    fs.rmSync(tmp);
  }
  console.log(`  wrote ${name}.wav`);
}

const ROBERT = 'george';
const PHARMACIST = 'jane';

console.log('Robert, first half');
const a = await tts('I need to refill my', ROBERT);
console.log(`  "${a.spoken}" ${(a.pcm.length / 2 / RATE).toFixed(2)}s`);
console.log('Robert, second half');
const b = await tts('amlodipine prescription, please.', ROBERT);
console.log(`  "${b.spoken}" ${(b.pcm.length / 2 / RATE).toFixed(2)}s`);

// 500ms of room tone before he starts, the 6000ms word-finding block, and 1500ms
// after, so both listening streams hear the silence that ends the turn.
const caller = Buffer.concat([silence(500), trim(a.pcm), silence(6000), trim(b.pcm), silence(1500)]);
save('caller-pause-6s', caller, { to16k: true });

for (const [name, text] of [
  ['pharmacist-hello-24k', 'Hello? Are you there?'],
  ['pharmacist-which-24k', 'Okay. Which medicine is it about?'],
  ['pharmacist-thanks-24k', 'Thank you. Let me check that for you.'],
]) {
  console.log(`Pharmacist: ${text}`);
  const r = await tts(text, PHARMACIST);
  save(name, trim(r.pcm));
}
console.log('done');
