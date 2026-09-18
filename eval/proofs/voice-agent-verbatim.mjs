// PROOF: can the Voice Agent API be made to speak ONLY what our own endpoint returns?
//
//  1. local server pretending to be an OpenAI-compatible LLM (it is really the Adjudicator)
//  2. Cloudflare quick tunnel -> public https URL (required by the Voice Agent API)
//  3. stored agent whose llm.base_url is that tunnel
//  4. bind a WS session to the agent, then reply.create
//  5. check: did the agent speak our exact text, and what did its request look like?
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';

const KEY = process.env.ASSEMBLYAI_API_KEY;
if (!KEY) { console.error('set ASSEMBLYAI_API_KEY'); process.exit(1); }
const VERBATIM = process.env.EMPTY ? '' : 'Hello, this is One Moment. He is still with you, one moment please.';
const PORT = 8788;
const log = (...a) => console.log(`[+${String(Date.now() - T0).padStart(6)}ms]`, ...a);
const T0 = Date.now();
const requests = [];

// ---- 1. the "LLM", which is really the Adjudicator's output channel ----------
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
    const j = JSON.parse(body || '{}');
    requests.push({ url: req.url, auth: req.headers.authorization, stream: j.stream, model: j.model,
      messages: (j.messages || []).map((m) => ({ role: m.role, content: String(m.content).slice(0, 120) })) });
    log(`LLM request #${requests.length}: stream=${j.stream} model=${j.model} messages=${(j.messages || []).length} auth=${req.headers.authorization}`);
    const id = 'om-' + Date.now();
    const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: j.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    if (j.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(chunk(VERBATIM ? { role: 'assistant', content: VERBATIM } : { role: 'assistant' }));
      res.write(chunk({}, 'stop'));
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id, object: 'chat.completion', model: j.model, choices: [{ index: 0, message: { role: 'assistant', content: VERBATIM }, finish_reason: 'stop' }] }));
    }
    return;
  }
  log(`other request ${req.method} ${req.url}`);
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(PORT, r));
log('fake LLM listening on', PORT);

// ---- 2. tunnel ---------------------------------------------------------------
const tunnel = spawn('node_modules/cloudflared/bin/cloudflared.exe', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`]);
const publicUrl = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('tunnel timeout')), 90000);
  const onData = (d) => {
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) { clearTimeout(t); resolve(m[0]); }
  };
  tunnel.stdout.on('data', onData); tunnel.stderr.on('data', onData);
});
log('tunnel:', publicUrl);
await new Promise((r) => setTimeout(r, 4000)); // let DNS propagate

let agentId = null;
const cleanup = async (code) => {
  if (agentId) {
    const d = await fetch(`https://agents.assemblyai.com/v1/agents/${agentId}`, { method: 'DELETE', headers: { Authorization: KEY } });
    log('agent deleted:', d.status);
  }
  tunnel.kill(); server.close();
  fs.writeFileSync(new URL('./proof-requests.json', import.meta.url), JSON.stringify(requests, null, 2));
  process.exit(code);
};

try {
  // ---- 3. stored agent ---------------------------------------------------------
  const create = async (auth) => fetch('https://agents.assemblyai.com/v1/agents', {
    method: 'POST', headers: { Authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'one-moment-proof',
      system_prompt: 'You relay approved messages only.',
      voice: { voice_id: 'anna' },
      llm: [{ base_url: `${publicUrl}/v1`, model: 'one-moment-adjudicator', api_key: 'call-token-proof1' }],
    }),
  });
  let r = await create(KEY);
  if (r.status === 401) r = await create(`Bearer ${KEY}`);
  const created = await r.json();
  if (!r.ok) { log('agent create FAILED', r.status, JSON.stringify(created).slice(0, 400)); await cleanup(1); }
  agentId = created.id;
  log('stored agent created:', agentId);

  // ---- 4. bind a session and ask it to speak -----------------------------------
  const ws = new WebSocket('wss://agents.assemblyai.com/v1/ws', { headers: { Authorization: `Bearer ${KEY}` } });
  const spoken = [];
  let replyAt = null;
  await new Promise((resolve) => {
    const t = setTimeout(() => { log('TIMEOUT'); resolve(); }, 45000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'session.update', session: { agent_id: agentId } })));
    ws.on('message', (raw) => {
      const ev = JSON.parse(raw.toString());
      if (!['reply.audio', 'transcript.agent.delta'].includes(ev.type)) log('event', ev.type, ev.type === 'session.error' ? JSON.stringify(ev) : '');
      if (ev.type === 'session.ready') {
        ws.send(JSON.stringify({ type: 'conversation.message', role: 'system', content: 'ONE_MOMENT_CALL_ID=proof1' }));
        replyAt = Date.now();
        ws.send(JSON.stringify({ type: 'reply.create' }));
        log('sent reply.create');
      }
      if (ev.type === 'transcript.agent') spoken.push(ev.text ?? ev.transcript ?? JSON.stringify(ev));
      if (ev.type === 'reply.audio' && !globalThis.firstAudio) { globalThis.firstAudio = Date.now(); log('FIRST reply.audio', replyAt ? `${Date.now()-replyAt}ms after reply.create` : ''); }
      if (ev.type === 'reply.done') { log('reply.done status=' + (ev.status ?? '?')); clearTimeout(t); resolve(); }
    });
    ws.on('unexpected-response', (_, res) => { log('WS HTTP', res.statusCode); clearTimeout(t); resolve(); });
  });
  ws.close();

  // ---- 5. verdict ------------------------------------------------------------------
  console.log('\n================ VERDICT ================');
  console.log('our endpoint was called     :', requests.length, 'time(s)');
  console.log('agent spoke                 :', JSON.stringify(spoken));
  console.log('verbatim match              :', spoken.some((s) => s.trim() === VERBATIM) ? 'YES, word for word' : 'NO');
  console.log('reply.create -> spoken      :', replyAt ? `${Date.now() - replyAt}ms (includes tunnel)` : 'n/a');
  if (requests[0]) {
    console.log('request shape               : stream=' + requests[0].stream + ' auth=' + requests[0].auth);
    console.log('messages the agent sent us  :');
    for (const m of requests[0].messages) console.log('   ', m.role.padEnd(9), JSON.stringify(m.content));
  }
  await cleanup(0);
} catch (e) {
  log('ERROR', e.message);
  await cleanup(1);
}
