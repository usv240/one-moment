// Probe: does a slurred medication name split the two ears?
//
// The patient ear carries the caller's vocabulary in keyterms_prompt; the fast
// ear does not. If the patient ear "hears" amlodipine where the fast ear hears
// something else, the boosted word was not independently confirmed, and the
// system should ask rather than trust it. This finds a spoken variant that
// produces that split, using AssemblyAI text to speech for the variants.
//
// Usage: node --env-file=.env eval/probe-vocabulary.mjs

import WebSocket from 'ws';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fastConfig, patientConfig } from '@one-moment/core';

const key = process.env.ASSEMBLYAI_API_KEY;
const REST = 'https://agents.assemblyai.com/v1/agents';

async function tts(text, voice = 'george') {
  const res = await fetch(REST, { method: 'POST', headers: { Authorization: key, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `om-probe-${Date.now()}`, system_prompt: 'Say nothing beyond the greeting.', voice: { voice_id: voice }, greeting: text }) });
  const agent = await res.json();
  try {
    return await new Promise((resolve, reject) => {
      const chunks = [];
      const ws = new WebSocket('wss://agents.assemblyai.com/v1/ws', { headers: { Authorization: `Bearer ${key}` } });
      const timer = setTimeout(() => { ws.close(); reject(new Error('tts timeout')); }, 30000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'session.update', session: { agent_id: agent.id } })));
      ws.on('message', (raw) => {
        const ev = JSON.parse(raw.toString());
        if (ev.type === 'reply.audio') chunks.push(Buffer.from(ev.data, 'base64'));
        if (ev.type === 'reply.done') { clearTimeout(timer); ws.close(); resolve(Buffer.concat(chunks)); }
      });
    });
  } finally {
    await fetch(`${REST}/${agent.id}`, { method: 'DELETE', headers: { Authorization: key } }).catch(() => {});
  }
}

function to16k(pcm24) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-'));
  const a = path.join(dir, 'a.raw');
  const b = path.join(dir, 'b.raw');
  fs.writeFileSync(a, pcm24);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', a, '-f', 's16le', '-ar', '16000', '-ac', '1', b]);
  return fs.readFileSync(b);
}

function stream(config, pcm) {
  const qs = new URLSearchParams(Object.entries(config).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? JSON.stringify(v) : String(v)]])));
  return new Promise((resolve) => {
    const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${qs}`, { headers: { Authorization: key } });
    const finals = [];
    ws.on('open', async () => {
      const frame = 1600;
      const padded = Buffer.concat([pcm, Buffer.alloc(16000 * 2 * 3)]);
      for (let i = 0; i < padded.length; i += frame) {
        ws.send(padded.subarray(i, i + frame));
        await new Promise((r) => setTimeout(r, 50));
      }
      ws.send(JSON.stringify({ type: 'ForceEndpoint' }));
      setTimeout(() => ws.send(JSON.stringify({ type: 'Terminate' })), 1500);
    });
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'Turn' && m.end_of_turn) finals.push(m.transcript);
      if (m.type === 'Termination') { ws.close(); }
    });
    ws.on('close', () => resolve(finals.join(' ')));
  });
}

const VARIANTS = [
  'I need to refill my am low dippy prescription, please.',
  'I need to refill my amla deepin prescription, please.',
  'I need to refill my amblo, dipine prescription, please.',
  'I need to refill my, um, am, am lo, prescription, please.',
];
for (const v of VARIANTS) {
  const pcm = to16k(await tts(v));
  const [p, f] = await Promise.all([
    stream(patientConfig(['amlodipine', 'metformin'], 'The caller is phoning his pharmacy about his medicines.'), pcm),
    stream(fastConfig(), pcm),
  ]);
  const hasP = /amlodipine/i.test(p);
  const hasF = /amlodipine/i.test(f);
  console.log(`${hasP && !hasF ? 'SPLIT ' : '      '} said: ${v}\n        patient: ${p}\n        fast:    ${f}\n`);
  await new Promise((r) => setTimeout(r, 4000));
}
