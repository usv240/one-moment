// The orchestrator's front door.
//
//   GET  /health
//   POST /v1/decide                 public API: a Turn in, the Adjudicator's decision out
//   GET  /v1/models                 LLM Gateway models your key can use
//   POST /llm/v1/chat/completions   called by the Voice Agent, Bearer <call token>
//   GET  /calls/:id/events          full stamped event log, for exact replay
//   GET  /calls/:id/escalation      the handoff packet for a human relay assistant
//   POST /twilio/voice              TwiML for an inbound phone call
//   WS   /twilio/stream             the phone leg: Twilio Media Streams, 8kHz mu-law
//   WS   /ws                        browsers: JSON control messages + binary audio
//
// Browser audio frames: caller sends 16kHz PCM16, far party sends 24kHz PCM16.
// Server audio frames: 1-byte channel header (1 caller, 2 far, 3 agent) + PCM16.

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { callRecord, isVoice, recordAsText, type CallerProfile, type ClientMessage, type LexiconTerm, type VoiceId } from '@one-moment/core';
import { AUDIO_CHANNEL, Call } from './call.ts';
import { openTunnel } from './tunnel.ts';
import { isScenario, Simulator } from './simulator.ts';
import { BadRequest, decide } from './api.ts';
import { clientIp, Guard, guardOptionsFromEnv } from './guard.ts';
import { bridgeCall, inboundTwiml, isFromTwilio } from './telephony.ts';

export const DEMO_PROFILE: CallerProfile = {
  displayName: 'Robert',
  pronoun: 'he',
  yesNoReliability: 'unknown',
  context: 'Robert has aphasia after a stroke and is calling his pharmacy. He takes amlodipine, a white tablet for blood pressure, and metformin.',
};

export const DEMO_LEXICON: LexiconTerm[] = [
  { term: 'amlodipine', category: 'medication' },
  { term: 'metformin', category: 'medication' },
  { term: 'Walgreens', category: 'pharmacy' },
  { term: 'Dr Alvarez', category: 'doctor', aliases: ['Doctor Alvarez'] },
  { term: 'prescription', category: 'other' },
  { term: 'refill', category: 'other' },
];

export type ServerHandle = {
  port: number;
  publicUrl: string | null;
  calls: Map<string, Call>;
  createCall: (opts?: { profile?: CallerProfile; lexicon?: LexiconTerm[]; retainAudio?: boolean; apiKey?: string; llmModel?: string; voice?: VoiceId }) => Promise<Call>;
  close: () => Promise<void>;
};

function sse(res: http.ServerResponse, model: string, text: string): void {
  const id = `om-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(chunk(text ? { role: 'assistant', content: text } : { role: 'assistant' }));
  res.write(chunk({}, 'stop'));
  res.end('data: [DONE]\n\n');
}

/**
 * An error from a call started on the shared key: does it mean the key itself
 * is finished, rather than something transient? Matched on the message because
 * the failure can surface from the REST API, the streaming socket or the Voice
 * Agent leg, each of which words it differently.
 */
export const keyRefused = (m: string) =>
  /401|402|403|unauthori[sz]ed|invalid api key|authentication|insufficient|quota|balance|payment|credit/i.test(m);

export async function startServer(opts: { port?: number; tunnel?: boolean; apiKey?: string } = {}): Promise<ServerHandle> {
  // Optional: without a server key, every call must bring its own.
  const apiKey = opts.apiKey ?? process.env.ASSEMBLYAI_API_KEY ?? null;
  if (!apiKey) console.warn('ASSEMBLYAI_API_KEY is not set: every call must bring its own key.');
  const guard = new Guard(guardOptionsFromEnv());
  const port = opts.port ?? Number(process.env.PORT ?? 8787);
  const allowed = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim());

  const calls = new Map<string, Call>();
  const byToken = new Map<string, Call>();

  /**
   * Is the shared demo key still usable?
   *
   * A public demo outlives the credit that pays for it. If the key expires or
   * runs out while people are still visiting, the orchestrator is up, so the
   * website thinks everything is fine, and a visitor clicking "play the
   * recorded call" gets a red error instead of the recording. That is worse
   * than being offline, because being offline already falls back gracefully.
   *
   * So the key's health is part of the health check: probed at startup, cheaply
   * and periodically after that, and marked bad the moment a real call is
   * refused for an auth or quota reason. The website reads this and falls back
   * to the recordings, while calls on a visitor's own key keep working.
   */
  let serverKeyOk = apiKey ? null : false; // null: not probed yet
  const probeKey = async (): Promise<void> => {
    if (!apiKey) return;
    const r = await fetch('https://api.assemblyai.com/v2/transcript?limit=1', { headers: { authorization: apiKey } }).catch(() => null);
    // A network blip is not evidence the key is bad; only a clear refusal is.
    if (r && (r.status === 401 || r.status === 402 || r.status === 403)) serverKeyOk = false;
    else if (r && r.ok) serverKeyOk = true;
  };

  const cors = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && allowed.includes(origin)) res.setHeader('access-control-allow-origin', origin);
  };

  const bearer = (req: http.IncomingMessage) => {
    const h = req.headers.authorization ?? '';
    const k = h.replace(/^Bearer\s+/i, '').trim();
    return k || null;
  };
  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readBody = async (req: http.IncomingMessage, limit = 64 * 1024): Promise<string> => {
    let body = '';
    for await (const c of req) {
      body += c;
      if (body.length > limit) throw new BadRequest('request body too large');
    }
    return body;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');

    // The public API is open to any origin: it holds no state and no secrets.
    if (url.pathname.startsWith('/v1/')) {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', 'authorization, content-type');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
      const ip = clientIp(req.headers, req.socket.remoteAddress);
      if (!guard.allowApi(ip)) { json(res, 429, { error: 'Too many requests. Try again in a minute.' }); return; }

      if (req.method === 'POST' && url.pathname === '/v1/decide') {
        try {
          const body = JSON.parse(await readBody(req));
          json(res, 200, await decide(body, bearer(req)));
        } catch (err) {
          const bad = err instanceof BadRequest || err instanceof SyntaxError;
          json(res, bad ? 400 : 500, { error: bad ? (err as Error).message : 'internal error' });
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/models') {
        const key = bearer(req);
        if (!key) { json(res, 401, { error: 'Send your AssemblyAI key as Authorization: Bearer <key>.' }); return; }
        const r = await fetch('https://llm-gateway.assemblyai.com/v1/models', { headers: { authorization: key } }).catch(() => null);
        if (!r || !r.ok) { json(res, r?.status === 401 ? 401 : 502, { error: 'Could not list models for that key.' }); return; }
        const data = (await r.json()) as { data?: { id: string }[] };
        json(res, 200, { models: (data.data ?? []).map((m) => m.id) });
        return;
      }
      json(res, 404, { error: 'not found' });
      return;
    }

    cors(req, res);

    // Twilio asks what to do with an inbound call. The answer connects the
    // caller's audio to this server's phone leg, both ways.
    if (url.pathname === '/twilio/voice' && (req.method === 'POST' || req.method === 'GET')) {
      const body = req.method === 'POST' ? await readBody(req).catch(() => '') : '';
      const params = Object.fromEntries(new URLSearchParams(body));
      const token = process.env.TWILIO_AUTH_TOKEN;
      // Unsigned requests are refused when a token is configured: without this
      // anyone who finds the URL can spend the demo key.
      if (token) {
        const full = `${process.env.PUBLIC_URL ?? handle.publicUrl ?? ''}/twilio/voice`;
        const ok = await isFromTwilio(token, req.headers['x-twilio-signature'] as string | undefined, full, params);
        if (!ok) { res.writeHead(403, { 'content-type': 'text/plain' }).end('bad signature'); return; }
      }
      const base = (process.env.PUBLIC_URL ?? handle.publicUrl ?? '').replace(/^http/, 'ws');
      res.writeHead(200, { 'content-type': 'text/xml' });
      res.end(inboundTwiml(`${base}/twilio/stream`, process.env.TWILIO_GREETING));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, {
        ok: true,
        calls: calls.size,
        publicUrl: handle.publicUrl,
        serverKey: Boolean(apiKey),
        /** null until probed. false means: fall back to the recordings, or bring your own key. */
        serverKeyOk,
        limits: { maxCallSeconds: guard.opts.maxCallMs / 1000, callsPerHour: guard.opts.perIpPerHour },
      });
      return;
    }

    // The Voice Agent's "LLM". It is not a model. It returns the Adjudicator's
    // approved text for this call, verbatim, or nothing at all.
    if (req.method === 'POST' && url.pathname === '/llm/v1/chat/completions') {
      let body = '';
      for await (const c of req) body += c;
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      const call = byToken.get(token);
      if (!call) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'unknown call token' } }));
        return;
      }
      let model = 'one-moment-adjudicator';
      let stream = true;
      try {
        const j = JSON.parse(body) as { model?: string; stream?: boolean };
        model = j.model ?? model;
        stream = j.stream !== false;
      } catch { /* default */ }
      const text = call.takeApprovedSpeech();
      if (stream) sse(res, model, text);
      else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: `om-${Date.now()}`, object: 'chat.completion', model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }));
      }
      return;
    }

    const m = url.pathname.match(/^\/calls\/([\w-]+)\/(events|escalation|record|record\.txt)$/);
    if (req.method === 'GET' && m) {
      const call = calls.get(m[1]!);
      if (!call) { res.writeHead(404).end(); return; }
      // What was said in the caller's name, for the caller to keep. The plain
      // text form is the one a person can read, print or hand to a pharmacist.
      if (m[2] === 'record' || m[2] === 'record.txt') {
        const rec = callRecord(call.history, { callId: call.id, caller: call.caller, startedAt: new Date(call.t0).toISOString() });
        if (m[2] === 'record.txt') {
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="one-moment-call-${call.id}.txt"` });
          res.end(recordAsText(rec));
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(rec, null, 2));
        }
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(m[2] === 'events' ? call.history : call.escalationPacket(), null, 2));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  });

  const createCall: ServerHandle['createCall'] = async (o = {}) => {
    const key = o.apiKey || apiKey;
    if (!key) throw new Error('This engine has no AssemblyAI key of its own. Add yours on the setup page.');
    const model = o.llmModel || (o.apiKey ? undefined : process.env.LLM_GATEWAY_MODEL) || undefined;
    const call = new Call({
      apiKey: key,
      publicUrl: handle.publicUrl,
      profile: o.profile ?? DEMO_PROFILE,
      lexicon: o.lexicon ?? DEMO_LEXICON,
      retainAudio: o.retainAudio ?? false,
      ...(model ? { llmModel: model } : {}),
      ...(o.voice ? { voice: o.voice } : {}),
    });
    calls.set(call.id, call);
    byToken.set(call.token, call);
    call.once('ended', () => {
      byToken.delete(call.token);
      setTimeout(() => calls.delete(call.id), 10 * 60 * 1000); // keep for replay a while
    });
    await call.start();
    return call;
  };

  /**
   * The phone leg. A real inbound call, bridged into exactly the same Call the
   * browser uses, so nothing in the decision layer knows it is on a phone.
   *
   * Guarded by the same demo limits as any other call, because a phone number
   * is the one entrance a stranger can find without visiting the website.
   */
  const phoneWss = new WebSocketServer({ noServer: true });
  phoneWss.on('connection', async (ws: WebSocket, req) => {
    const ip = clientIp(req.headers, req.socket.remoteAddress);
    const admitted = guard.admit(ip, false);
    if ('reason' in admitted) { ws.close(1013, 'busy'); return; }

    // Twilio starts talking the instant the socket opens, while opening two
    // listening streams and a Voice Agent still takes a few seconds. Anything
    // said in that window is queued rather than dropped: losing the "start"
    // event loses the stream id and the caller hears nothing back, and losing
    // audio is the one thing this product must never do.
    const early: Buffer[] = [];
    const queue = (raw: Buffer) => early.push(raw);
    ws.on('message', queue);

    let call: Call | null = null;
    try {
      call = await createCall({ retainAudio: false });
    } catch (err) {
      const m = (err as Error).message;
      if (keyRefused(m)) { serverKeyOk = false; void probeKey(); }
      admitted.release();
      ws.off('message', queue);
      ws.close(1011, 'could not start');
      return;
    }
    const limit = setTimeout(() => ws.close(1000, 'demo call limit'), guard.opts.maxCallMs);
    call.once('ended', () => { clearTimeout(limit); admitted.release(); });
    ws.off('message', queue);
    bridgeCall(ws, call, (m) => console.log(`[phone] ${m}`));
    for (const raw of early) ws.emit('message', raw);
  });

  const wss = new WebSocketServer({ noServer: true });

  // Two WebSocket servers on one HTTP server have to share the upgrade event:
  // letting ws attach its own listener twice makes both try to complete the
  // same handshake, which shows up as "RSV1 must be clear" on the first frame.
  server.on('upgrade', (req, socket, head) => {
    const p = new URL(req.url ?? '/', 'http://x').pathname;
    const target = p === '/ws' ? wss : p === '/twilio/stream' ? phoneWss : null;
    if (!target) { socket.destroy(); return; }
    target.handleUpgrade(req, socket, head, (client) => target.emit('connection', client, req));
  });

  wss.on('connection', (ws: WebSocket, req) => {
    const origin = req.headers.origin;
    if (origin && !allowed.includes(origin)) { ws.close(1008, 'origin not allowed'); return; }

    const ip = clientIp(req.headers, req.socket.remoteAddress);
    let call: Call | null = null;
    let release: (() => void) | null = null;
    let role: 'caller' | 'far' = 'caller';
    let mode: 'live' | 'sample' = 'live';
    let sim: Simulator | null = null;
    const detach: (() => void)[] = [];

    const attach = (c: Call) => {
      call = c;
      const onMsg = (msg: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
      const onAudio = (channel: keyof typeof AUDIO_CHANNEL, pcm: Buffer) => {
        // Nobody hears themselves echoed back. In sample mode the "caller" is a
        // recording, so the person watching should hear it.
        if (role === 'caller' && channel === 'caller' && mode !== 'sample') return;
        if (role === 'far' && channel === 'far') return;
        if (ws.readyState === ws.OPEN) ws.send(Buffer.concat([Buffer.from([AUDIO_CHANNEL[channel]]), pcm]));
      };
      c.on('message', onMsg);
      c.on('audio', onAudio);
      detach.push(() => { c.off('message', onMsg); c.off('audio', onAudio); });
      for (const h of c.history) onMsg(h); // late joiners see the whole call so far
    };

    ws.on('message', async (data, isBinary) => {
      if (isBinary) {
        const buf = data as Buffer;
        if (role === 'caller' && mode === 'live') call?.callerFrame(buf);
        else if (role === 'far') call?.farFrame(buf);
        return;
      }
      let msg: ClientMessage;
      try { msg = JSON.parse(String(data)); } catch { return; }
      try {
        switch (msg.type) {
          case 'hello':
            role = msg.role;
            if (msg.role === 'far') {
              const c = msg.callId ? calls.get(msg.callId) : [...calls.values()].at(-1);
              if (!c) { ws.send(JSON.stringify({ type: 'error', message: 'no such call', seq: -1, t: 0 })); return; }
              attach(c);
            } else {
              if (call) return; // one call per connection
              mode = msg.mode ?? 'live';
              const byo = typeof msg.apiKey === 'string' && msg.apiKey.trim().length > 0;
              const admitted = guard.admit(ip, byo);
              if ('reason' in admitted) {
                ws.send(JSON.stringify({ type: 'error', message: admitted.reason, seq: -1, t: 0 }));
                ws.close();
                return;
              }
              release = admitted.release;
              let c: Call;
              try {
                c = await createCall({
                  ...(msg.profile ? { profile: msg.profile } : {}),
                  ...(msg.lexicon ? { lexicon: msg.lexicon } : {}),
                  // The recorded demo caller is synthetic, so its audio is always kept for the self-audit.
                  retainAudio: mode === 'sample' || (msg.retainAudio ?? false),
                  ...(byo ? { apiKey: msg.apiKey!.trim() } : {}),
                  ...(msg.llmModel ? { llmModel: msg.llmModel } : {}),
                  // A voice typed by a visitor never reaches AssemblyAI: only ids we have verified.
                  ...(isVoice(msg.voice) ? { voice: msg.voice } : {}),
                });
              } catch (err) {
                release();
                release = null;
                const m = (err as Error).message;
                const bad = keyRefused(m);
                // If it was our own key that was refused, say so in the health
                // check, so the next visitor gets the recordings rather than this.
                if (bad && !byo) { serverKeyOk = false; void probeKey(); }
                throw new Error(bad
                  ? (byo
                    ? 'That AssemblyAI key was not accepted.'
                    : 'The shared demo key is not working right now. Hear three recorded calls at /replay, or bring your own AssemblyAI key on the setup page.')
                  : m);
              }
              c.once('ended', () => { release?.(); release = null; });
              // A demo call has a length limit, so one visitor cannot hold the shared key.
              const limit = setTimeout(() => {
                ws.send(JSON.stringify({ type: 'error', message: `Demo calls end after ${guard.opts.maxCallMs / 60000} minutes.`, seq: -1, t: 0 }));
                void c.end();
              }, guard.opts.maxCallMs);
              c.once('ended', () => clearTimeout(limit));
              attach(c);
              if (mode === 'sample' || msg.simulateFarParty) {
                sim = new Simulator(c, { playCaller: mode === 'sample', scenario: isScenario(msg.scenario) ? msg.scenario : 'pause' });
                c.once('ended', () => sim?.stop());
                sim.run();
              }
            }
            break;
          case 'choice': call?.choose(msg.questionId, msg.optionId); break;
          case 'something_else': call?.somethingElse(); break;
          case 'stop': call?.stop(); break;
          case 'escalate': call?.requestHuman(); break;
          case 'end':
            if (role === 'caller' && call) {
              // Grade before hanging up, if the caller kept the audio. The browser waits for it.
              await (call as Call).audit();
              await (call as Call).end();
              ws.close();
            }
            break;
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: (err as Error).message, seq: -1, t: 0 }));
      }
    });

    ws.on('close', () => {
      for (const d of detach) d();
      (sim as Simulator | null)?.stop();
      if (role === 'caller') void (call as Call | null)?.end();
      (release as (() => void) | null)?.();
    });
  });

  await new Promise<void>((r) => server.listen(port, r));

  const handle: ServerHandle = { port, publicUrl: process.env.PUBLIC_URL || null, calls, createCall, close: async () => {} };

  let tunnelProc: { kill: () => void } | null = null;
  if (!handle.publicUrl && opts.tunnel !== false) {
    const t = await openTunnel(port);
    if (t) { handle.publicUrl = t.url; tunnelProc = t.proc; }
  }

  // Know the key's state before the first visitor asks, and notice if it runs
  // out later. Fifteen minutes is often enough for a demo that outlives its
  // credit, and cheap enough to be invisible.
  void probeKey();
  const keyTimer = setInterval(() => void probeKey(), 15 * 60 * 1000);
  keyTimer.unref?.();

  handle.close = async () => {
    clearInterval(keyTimer);
    for (const c of calls.values()) await c.end();
    wss.close();
    tunnelProc?.kill();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return handle;
}

// Run directly: `npm run orchestrator`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const h = await startServer();
  console.log(`One Moment orchestrator on http://localhost:${h.port}`);
  console.log(h.publicUrl
    ? `Voice Agent endpoint: ${h.publicUrl}/llm/v1  (public, so the far-party leg is live)`
    : 'No public URL: the far-party leg is off and outward speech falls back to the browser.');
  const stop = async () => { await h.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
