// The far-party leg: an AssemblyAI Voice Agent whose LLM is One Moment.
//
// PROVEN 18 Sept (eval/proofs/voice-agent-verbatim.mjs): a stored agent whose
// llm.base_url points at our endpoint speaks our endpoint's text word for word,
// and stays silent when we return nothing. So the voice has no source of words
// other than the Adjudicator.
//
// Differences from the streaming STT API, all of which bite:
//  - REST and the WebSocket take different auth: REST accepts the raw key,
//    the WebSocket needs "Bearer <key>".
//  - Audio is 24kHz PCM16, base64 inside JSON, not raw binary frames.
//  - input.audio carries audio in `audio`; reply.audio carries it in `data`.
//  - agent_id is mutually exclusive with inline session fields.

import WebSocket from 'ws';
import { EventEmitter } from 'node:events';

const REST = 'https://agents.assemblyai.com/v1/agents';
const WS_URL = 'wss://agents.assemblyai.com/v1/ws';

export type AgentSpec = {
  name: string;
  /** Public HTTPS base URL of our OpenAI-compatible endpoint, ending in /v1. */
  llmBaseUrl: string;
  /** Arrives at our endpoint as `Authorization: Bearer <token>`. Identifies the call. */
  callToken: string;
  voice?: string;
  keyterms?: string[];
};

export async function createAgent(apiKey: string, spec: AgentSpec): Promise<string> {
  const body = {
    name: spec.name,
    // Never used to compose words: our endpoint ignores it. Kept honest anyway,
    // because it is visible in the AssemblyAI dashboard.
    system_prompt: 'You relay messages approved by One Moment. You never compose your own words.',
    voice: { voice_id: spec.voice ?? 'anna' },
    llm: [{ base_url: spec.llmBaseUrl, model: 'one-moment-adjudicator', api_key: spec.callToken }],
  };
  const res = await fetch(REST, {
    method: 'POST',
    headers: { Authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { id?: string; error?: unknown };
  if (!res.ok || !json.id) throw new Error(`agent create failed ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json.id;
}

export async function deleteAgent(apiKey: string, id: string): Promise<void> {
  await fetch(`${REST}/${id}`, { method: 'DELETE', headers: { Authorization: apiKey } }).catch(() => {});
}

export interface AgentEvents {
  ready: [sessionId: string];
  far_speech_started: [];
  far_speech_stopped: [];
  far_partial: [text: string];
  far_final: [text: string];
  reply_started: [];
  reply_audio: [base64: string];
  reply_text: [text: string];
  /** `spoke` is false when the agent dropped the reply without saying a word. */
  reply_done: [status: string, spoke: boolean];
  error: [message: string];
  closed: [];
}

export class VoiceAgentSession extends EventEmitter<AgentEvents> {
  private ws: WebSocket | null = null;
  private replyPending = false;
  private replySpoke = false;
  replying = false;
  private apiKey: string;
  private agentId: string;

  constructor(apiKey: string, agentId: string) {
    super();
    this.apiKey = apiKey;
    this.agentId = agentId;
  }

  open(timeoutMs = 15000): Promise<string> {
    const ws = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${this.apiKey}` } });
    this.ws = ws;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`voice agent: no session.ready after ${timeoutMs}ms`)), timeoutMs);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'session.update', session: { agent_id: this.agentId } })));
      ws.on('message', (raw) => {
        let ev: Record<string, unknown>;
        try { ev = JSON.parse(raw.toString()); } catch { return; }
        const text = (ev.text ?? ev.transcript ?? '') as string;
        if (process.env.OM_TRACE_AGENT && ev.type !== 'reply.audio' && ev.type !== 'transcript.user.delta' && ev.type !== 'transcript.agent.delta') {
          const extra = Object.fromEntries(Object.entries(ev).filter(([k]) => !['type', 'data', 'audio'].includes(k)));
          console.log(`    [agent] ${String(ev.type).padEnd(22)} ${JSON.stringify(extra).slice(0, 160)}`);
        }
        switch (ev.type) {
          case 'session.ready':
            clearTimeout(timer);
            this.emit('ready', String(ev.session_id ?? ''));
            resolve(String(ev.session_id ?? ''));
            break;
          case 'input.speech.started': this.emit('far_speech_started'); break;
          case 'input.speech.stopped': this.emit('far_speech_stopped'); break;
          case 'transcript.user.delta': this.emit('far_partial', text); break;
          case 'transcript.user': this.emit('far_final', text); break;
          case 'reply.started':
            this.replying = true;
            this.replyPending = false;
            this.replySpoke = false;
            this.emit('reply_started');
            break;
          case 'reply.audio': this.emit('reply_audio', String(ev.data ?? '')); break;
          case 'transcript.agent':
            if (text) { this.replySpoke = true; this.emit('reply_text', text); }
            break;
          case 'reply.done':
            // MEASURED 18 Sept: when the far party speaks again while a reply is
            // being prepared, the agent drops that reply and still reports
            // status "completed", with no transcript.agent. The status field
            // cannot be trusted to mean "was heard". Whether a transcript
            // arrived can.
            this.replying = false;
            this.emit('reply_done', String(ev.status ?? 'completed'), this.replySpoke);
            break;
          case 'session.error':
            this.emit('error', JSON.stringify(ev).slice(0, 300));
            break;
        }
      });
      ws.on('error', (err) => { clearTimeout(timer); this.emit('error', err.message); reject(err); });
      ws.on('close', () => { clearTimeout(timer); this.emit('closed'); });
    });
  }

  /** Far-party microphone audio: 24kHz PCM16 mono. */
  sendAudio(pcm24k: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input.audio', audio: pcm24k.toString('base64') }));
    }
  }

  /**
   * Ask the agent to speak now. It will call our endpoint, which returns the
   * queued, approved text. Coalesced: one request in flight at a time.
   */
  requestReply(): boolean {
    if (this.replying || this.replyPending || this.ws?.readyState !== WebSocket.OPEN) return false;
    this.replyPending = true;
    this.ws.send(JSON.stringify({ type: 'reply.create' }));
    return true;
  }

  close(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'session.end' }));
      this.ws.close();
    }
  }
}
