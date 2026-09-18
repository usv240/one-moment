// AssemblyAI Universal-Streaming session.
//
// Hard-won rules, each measured against the live API:
//  - Auth is the raw key in the Authorization header, no "Bearer".
//  - Audio is raw binary PCM16 frames, 50 to 1000ms each, no faster than real time.
//  - A terminated session lingers on the account's session count for tens of
//    seconds. Never re-open a session to change configuration mid-call; use
//    UpdateConfiguration. Churning sessions produces a spurious
//    "Too many concurrent sessions" error.
//  - Always send Terminate. An abandoned session bills until the 3-hour cap.

import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import type { RealtimeConfig, StreamTurn } from '@one-moment/core';

const URL_BASE = 'wss://streaming.assemblyai.com/v3/ws';

export { fastConfig, patientConfig, type RealtimeConfig } from '@one-moment/core';

export interface RealtimeEvents {
  begin: [id: string];
  turn: [turn: StreamTurn];
  speech_started: [];
  error: [message: string];
  closed: [code: number];
}

export class RealtimeStream extends EventEmitter<RealtimeEvents> {
  readonly name: string;
  private ws: WebSocket | null = null;
  private opened = false;
  private terminated = false;
  sessionId: string | null = null;
  private apiKey: string;
  private config: RealtimeConfig;

  // Plain fields, not parameter properties: Node's native TypeScript support
  // only strips erasable syntax, and parameter properties are not erasable.
  constructor(name: string, apiKey: string, config: RealtimeConfig) {
    super();
    this.name = name;
    this.apiKey = apiKey;
    this.config = config;
  }

  open(timeoutMs = 15000): Promise<string> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(this.config)) {
      if (v === undefined) continue;
      params.set(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
    }
    const ws = new WebSocket(`${URL_BASE}?${params}`, { headers: { Authorization: this.apiKey } });
    this.ws = ws;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`[${this.name}] no Begin after ${timeoutMs}ms`)), timeoutMs);
      ws.on('message', (raw) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        switch (msg.type) {
          case 'Begin':
            this.opened = true;
            this.sessionId = String(msg.id);
            clearTimeout(timer);
            this.emit('begin', this.sessionId);
            resolve(this.sessionId);
            break;
          case 'Turn':
            this.emit('turn', msg as unknown as StreamTurn);
            break;
          case 'SpeechStarted':
            this.emit('speech_started');
            break;
          case 'Termination':
            break;
          default:
            if (msg.error) this.emit('error', String(msg.error));
        }
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        this.emit('error', err.message);
        if (!this.opened) reject(err);
      });
      ws.on('close', (code, reason) => {
        clearTimeout(timer);
        this.emit('closed', code);
        if (!this.opened) reject(new Error(`[${this.name}] closed before Begin: ${code} ${reason}`));
      });
    });
  }

  /** One 50ms PCM16 frame. */
  send(frame: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame);
  }

  /** End the current turn now. The server finalises it and emits end_of_turn. */
  forceEndpoint(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'ForceEndpoint' }));
  }

  /** Mid-session change, without re-opening. keyterms_prompt, prompt, silence bounds, vad. */
  update(fields: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'UpdateConfiguration', ...fields }));
    }
  }

  async close(drainMs = 3000): Promise<void> {
    if (this.terminated || !this.ws) return;
    this.terminated = true;
    const ws = this.ws;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'Terminate' }));
      await new Promise<void>((r) => {
        const t = setTimeout(r, drainMs);
        ws.once('close', () => { clearTimeout(t); r(); });
      });
    }
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }
}
