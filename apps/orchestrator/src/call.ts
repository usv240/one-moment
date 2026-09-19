// One call, end to end.
//
//   caller mic --16kHz--> patient stream (max_accuracy, 9s patience, lexicon)
//              \-------> fast stream    (min_latency, defaults, unbiased)
//   far mic ----24kHz--> Voice Agent session (hears the far party, speaks for us)
//
//   patient turn final -> evidence -> Floor Controller -> Dissent -> relay | ask
//   far party speaks mid-turn -> Floor Controller queues a hold line
//   Voice Agent asks our endpoint what to say -> we return ONLY approved text
//
// The Floor Controller and the Adjudicator are deterministic. The only way a
// word reaches the far party is through `outbox`, and the only things that
// write to `outbox` are Floor Controller actions.

import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  assembleEvidence, buildQuestion, ChurnTracker, DEFAULT_FLOOR_CONFIG, discoverModel, initialFloor,
  EARLY_END_SILENCE_MS, normalizeTokens, runDissent, soundsFinished, stepFloor,
  type CallerProfile, type DissentResult, type EscalationPacket, type EvidenceBundle, type FloorAction,
  type FloorConfig, type FloorEvent, type FloorModel, type ForcedChoice, type LexiconTerm,
  type ServerMessage, type StreamTurn, type VoiceId,
} from '@one-moment/core';
import { fastConfig, patientConfig, RealtimeStream } from './realtime.ts';

export { soundsFinished } from '@one-moment/core';
import { createAgent, deleteAgent, VoiceAgentSession } from './voice-agent.ts';
import { grade, transcribeCarefully } from './audit.ts';

type Unstamped = ServerMessage extends infer M ? (M extends ServerMessage ? Omit<M, 'seq' | 't'> : never) : never;

export type CallOptions = {
  apiKey: string;
  /** Public HTTPS URL of this orchestrator. Without it the far leg cannot run. */
  publicUrl: string | null;
  profile: CallerProfile;
  lexicon: LexiconTerm[];
  retainAudio: boolean;
  llmModel?: string;
  /** Bring your own voice: already checked against VOICES by the server. */
  voice?: VoiceId;
};

export interface CallEvents {
  message: [msg: ServerMessage];
  audio: [channel: AudioChannel, pcm: Buffer];
  ended: [];
}

/** Binary frames to browsers carry a one-byte channel header. */
export const AUDIO_CHANNEL = { caller: 1, far: 2, agent: 3 } as const;

/** Caller frame RMS above this counts as voice, for the silence clock. */
const VOICE_RMS = 0.015;

export type AudioChannel = keyof typeof AUDIO_CHANNEL;

type Outgoing = { kind: 'disclosure' | 'hold' | 'relay'; text: string; discloses?: boolean };

export class Call extends EventEmitter<CallEvents> {
  readonly id = randomBytes(6).toString('base64url');
  /** Unguessable. The Voice Agent presents it as a Bearer token to our endpoint. */
  readonly token = randomBytes(24).toString('base64url');
  readonly t0 = Date.now();
  readonly history: ServerMessage[] = [];
  readonly transcript: EscalationPacket['transcript'] = [];

  /** How the caller is named in anything this call produces. */
  get caller(): string {
    return this.opts.profile.displayName;
  }

  private opts: CallOptions;
  private seq = 0;
  private patient: RealtimeStream;
  private fast: RealtimeStream;
  private agent: VoiceAgentSession | null = null;
  private agentId: string | null = null;
  private floor: FloorModel = initialFloor();
  private floorCfg: FloorConfig;
  private churn = new ChurnTracker();
  private fastFinals: StreamTurn[] = [];
  private outbox: Outgoing[] = [];
  /**
   * Handed to the Voice Agent but not yet proven spoken. Cleared only when the
   * agent's own transcript.agent arrives. Every endpoint call re-sends these
   * first, so a line the far party talked over is never silently lost.
   *
   * MEASURED 18 Sept: the agent calls our endpoint for its next reply over HTTP
   * at the same moment it reports the dropped reply over the WebSocket, and HTTP
   * can win. So nothing here depends on the order of those two events.
   */
  private unconfirmed: Outgoing[] = [];
  private farSpeaking = false;
  /** The lines in the reply the agent is currently speaking. */
  private inFlight: Outgoing[] = [];
  /**
   * When the agent's forwarded audio will finish playing, on the call clock.
   * The Voice Agent streams speech faster than real time, so reply.done arrives
   * well before the far party has heard the end of it.
   */
  private agentPlayUntil = 0;
  private dropAgentAudio = false;
  /** Set when a reply ended without its lines being heard in full, so the next take is a genuine repeat. */
  private talkedOver = false;
  private fastMaxEnd = 0;
  private lastVoiceAt = 0;
  private patientPartial: StreamTurn | null = null;
  private lastFastFinal: StreamTurn | null = null;
  private forcedTurn = -1;
  private tick: NodeJS.Timeout | null = null;
  private pendingQuestion: ForcedChoice | null = null;
  private lastDissent: DissentResult | null = null;
  private model: string | null = null;
  private callerAudio: Buffer[] = [];
  private ended = false;

  constructor(opts: CallOptions) {
    super();
    this.opts = opts;
    this.floorCfg = { ...DEFAULT_FLOOR_CONFIG, userName: opts.profile.displayName, pronoun: opts.profile.pronoun };
    const keyterms = opts.lexicon.flatMap((l) => [l.term, ...(l.aliases ?? [])]);
    this.patient = new RealtimeStream('patient', opts.apiKey, patientConfig(keyterms, opts.profile.context));
    this.fast = new RealtimeStream('fast', opts.apiKey, fastConfig());
  }

  now(): number {
    return Date.now() - this.t0;
  }

  private send(msg: Unstamped): void {
    const stamped = { ...msg, seq: this.seq++, t: this.now() } as ServerMessage;
    this.history.push(stamped);
    this.emit('message', stamped);
  }

  private log(message: string): void {
    this.send({ type: 'log', message });
  }

  /** For the simulator: record what the simulated parties did, in the same stamped log. */
  note(event: 'caller_sample_started' | 'caller_sample_ended' | 'pharmacist_spoke' | 'caller_chose' | 'call_complete', detail?: string): void {
    this.send({ type: 'simulation', event, ...(detail ? { detail } : {}) });
    if (event === 'call_complete') void this.audit();
  }

  private auditing: Promise<void> | null = null;
  private chosenLabels: string[] = [];
  private patientFinals: StreamTurn[] = [];

  /**
   * Grade this call against AssemblyAI's pre-recorded transcript of the
   * caller's own audio. Needs retained audio, so it runs only when the caller
   * agreed to keep it, or for the recorded demo caller. Runs once.
   */
  audit(): Promise<void> {
    if (this.auditing) return this.auditing;
    const pcm = this.retainedAudio();
    if (!pcm) return Promise.resolve();
    const t0 = Date.now();
    this.log('Grading this call: sending the caller\'s audio to AssemblyAI\'s pre-recorded model, built for accuracy rather than speed.');
    // Once it has been sent for grading, the audio is not kept here any longer.
    this.callerAudio = [];
    this.auditing = transcribeCarefully(this.opts.apiKey, pcm)
      .then((careful) => {
        const relays = this.history.flatMap((m) => (m.type === 'outward' && m.kind === 'relay' ? [m.text] : []));
        this.send({ type: 'audit', audit: grade({ careful, patientTurns: this.patientFinals, relays, callerName: this.opts.profile.displayName, chosen: this.chosenLabels, ms: Date.now() - t0 }) });
      })
      .catch((err) => { this.send({ type: 'audit_failed', message: (err as Error).message }); });
    return this.auditing;
  }

  get floorState() {
    return this.floor.state;
  }

  get relaysSpoken(): number {
    return this.transcript.filter((x) => x.speaker === 'agent' && /says:|is asking|wants|would like/i.test(x.text)).length;
  }

  async start(): Promise<void> {
    const [p, f] = await Promise.all([this.patient.open(), this.fast.open()]);
    this.wireStreams();

    void discoverModel({ apiKey: this.opts.apiKey, model: this.opts.llmModel }).then((m) => {
      this.model = m;
      this.log(m ? `Dissent model: ${m}` : 'No LLM Gateway model reachable. Every turn will be asked, never relayed.');
    });

    if (this.opts.publicUrl) {
      try {
        // Our resolver seeing the tunnel does not mean AssemblyAI's does yet.
        // Retry only that specific failure, briefly.
        for (let attempt = 1; ; attempt++) {
          try {
            this.agentId = await createAgent(this.opts.apiKey, {
              name: `one-moment-${this.id}`,
              llmBaseUrl: `${this.opts.publicUrl}/llm/v1`,
              callToken: this.token,
              ...(this.opts.voice ? { voice: this.opts.voice } : {}),
            });
            break;
          } catch (err) {
            if (attempt >= 6 || !/does not resolve/i.test((err as Error).message)) throw err;
            this.log(`Far-party endpoint not resolvable by AssemblyAI yet, retrying (${attempt}/5).`);
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
        this.agent = new VoiceAgentSession(this.opts.apiKey, this.agentId);
        this.wireAgent(this.agent);
        await this.agent.open();
        this.log('Far-party leg ready. The Voice Agent can speak only what the Adjudicator approves.');
      } catch (err) {
        this.agent = null;
        this.log(`Far-party leg unavailable (${(err as Error).message}). Outward speech falls back to the browser.`);
      }
    } else {
      this.log('No public URL, so no Voice Agent. Outward speech falls back to the browser.');
    }

    this.tick = setInterval(() => {
      this.step({ type: 'tick', at: this.now() });
      this.maybeEndTurnEarly();
    }, 250);
    this.send({ type: 'ready', callId: this.id, role: 'caller', streams: { patient: p, fast: f }, farLeg: this.agent ? 'voice-agent' : 'browser', caller: this.opts.profile.displayName, lexicon: this.opts.lexicon.map((l) => l.term) });
    this.sendFloor();
  }

  // ---- audio in -----------------------------------------------------------

  /** Caller microphone, 16kHz PCM16, one 50ms frame. */
  callerFrame(frame: Buffer): void {
    let sq = 0;
    for (let i = 0; i + 1 < frame.length; i += 2) { const v = frame.readInt16LE(i) / 32768; sq += v * v; }
    if (Math.sqrt(sq / Math.max(1, frame.length / 2)) > VOICE_RMS) this.lastVoiceAt = this.now();
    this.patient.send(frame);
    this.fast.send(frame);
    if (this.opts.retainAudio) this.callerAudio.push(frame);
    this.emit('audio', 'caller', frame);
  }

  /** Far-party microphone, 24kHz PCM16. */
  farFrame(frame: Buffer): void {
    this.agent?.sendAudio(frame);
    this.emit('audio', 'far', frame);
  }

  // ---- streams ------------------------------------------------------------

  private wireStreams(): void {
    this.fast.on('turn', (t) => {
      // The fast stream is the quick one, so it is the one that notices the
      // caller has found the word. Only words that start after everything heard
      // so far count: revisions of old words are not new speech.
      const fresh = (t.words ?? []).some((w) => w.start > this.fastMaxEnd + 150);
      for (const w of t.words ?? []) this.fastMaxEnd = Math.max(this.fastMaxEnd, w.end);
      if (fresh) this.callerResumed();
      if (t.transcript || t.words?.length) this.step({ type: 'user_speech', at: this.now() });
      if (t.end_of_turn) { this.fastFinals.push(t); if (t.transcript) this.lastFastFinal = t; }
      this.send({ type: 'turn', stream: 'fast', turn: t });
    });

    this.patient.on('turn', (t) => {
      this.churn.observe(t);
      this.send({ type: 'turn', stream: 'patient', turn: t });
      if (!t.end_of_turn) {
        this.patientPartial = t;
        if (t.transcript) this.step({ type: 'user_speech', at: this.now() });
        return;
      }
      this.patientPartial = null;
      this.patientFinals.push(t);
      const evidence = assembleEvidence({
        patient: t,
        fastFinals: this.fastFinals,
        lexicon: this.opts.lexicon,
        churn: this.churn.churn(t.turn_order),
      });
      this.transcript.push({ speaker: 'caller', text: t.transcript, at: this.now() });
      this.send({ type: 'evidence', evidence });
      this.step({ type: 'user_turn_final', at: this.now(), evidence });
    });

    for (const s of [this.patient, this.fast]) {
      s.on('error', (m) => this.log(`${s.name} stream: ${m}`));
    }
  }

  private wireAgent(a: VoiceAgentSession): void {
    a.on('far_speech_started', () => {
      this.farSpeaking = true;
      this.step({ type: 'far_speech', at: this.now() });
    });
    a.on('far_speech_stopped', () => { this.farSpeaking = false; });
    a.on('far_final', (text) => {
      this.farSpeaking = false;
      if (!text) return;
      this.transcript.push({ speaker: 'far', text, at: this.now() });
      this.send({ type: 'far_heard', text });
      this.step({ type: 'far_turn_final', at: this.now(), text });
    });
    a.on('reply_started', () => { this.dropAgentAudio = false; });
    a.on('reply_audio', (b64) => {
      if (!b64 || this.dropAgentAudio) return;
      const pcm = Buffer.from(b64, 'base64');
      this.agentPlayUntil = Math.max(this.now(), this.agentPlayUntil) + (pcm.length / 2 / 24000) * 1000;
      this.emit('audio', 'agent', pcm);
    });
    a.on('reply_text', (text) => {
      this.transcript.push({ speaker: 'agent', text, at: this.now() });
      this.markSpoken(text);
      this.send({ type: 'agent_spoke', text });
    });
    a.on('reply_done', (status, spoke) => {
      if (this.unconfirmed.length) {
        this.talkedOver = true;
        this.log(`The far party spoke over an approved line (reply ${status}${spoke ? ', cut off part-way' : ', nothing heard'}). It will be repeated when it is not talking over anyone.`);
      }
      this.step({ type: 'outward_done', at: this.now() });
      if (this.worthSayingNow() && !this.farSpeaking) a.requestReply();
    });
    a.on('error', (m) => this.log(`voice agent: ${m}`));
  }

  /**
   * The caller found the word while a hold line was still playing. A hold line
   * exists to protect the caller's turn, so it must never talk over the caller:
   * stop forwarding the agent's audio now, and tell every browser to drop what
   * it has buffered. There is no cancel event in the Voice Agent API, but we
   * relay its audio, so we can simply stop relaying it.
   */
  private callerResumed(): void {
    const audible = this.now() < this.agentPlayUntil;
    if (!audible || !this.inFlight.length || this.inFlight.some((o) => o.kind === 'relay')) return;
    const cut = this.inFlight;
    this.inFlight = [];
    this.agentPlayUntil = 0;
    this.dropAgentAudio = this.agent?.replying ?? false;
    this.unconfirmed = this.unconfirmed.filter((o) => !cut.includes(o));
    this.send({ type: 'agent_cut', texts: cut.map((o) => o.text) });
    this.step({ type: 'outward_cut', at: this.now(), disclosureLost: cut.some((o) => o.discloses) });
  }

  /**
   * SEMANTIC PATIENCE. The patient ear waits at least 6 seconds of silence
   * before ending a turn, because a word-finding block can last that long. But
   * waiting 6 seconds after a sentence that is plainly finished is dead air the
   * far party will not tolerate. MEASURED 18 Sept: 8.5 seconds of silence
   * between the caller finishing and the relay starting.
   *
   * So: when the patient ear's running transcript ends like a finished sentence,
   * the fast ear has independently closed a turn on the same last words, and
   * the caller's audio has been silent for 1.5 seconds, end the turn now. A
   * sentence that trails off ("I need to refill my...") still gets the full wait.
   */
  private maybeEndTurnEarly(): void {
    const p = this.patientPartial;
    const f = this.lastFastFinal;
    if (!p || !f || p.turn_order === this.forcedTurn || !this.floor.userTurnOpen) return;
    const tail = (s: string) => normalizeTokens(s).slice(-2).join(' ');
    if (!soundsFinished(p.transcript) || !soundsFinished(f.transcript) || tail(p.transcript) !== tail(f.transcript)) return;
    if (this.now() - this.lastVoiceAt < EARLY_END_SILENCE_MS) return;
    this.forcedTurn = p.turn_order;
    this.log(`Both ears heard a finished sentence, then ${EARLY_END_SILENCE_MS / 1000}s of silence: ending the turn now instead of waiting the full 6 seconds. An unfinished sentence still gets the full wait.`);
    this.patient.forceEndpoint();
  }

  // ---- the Floor Controller -----------------------------------------------

  private step(e: FloorEvent): void {
    if (this.ended) return;
    const before = this.floor;
    const { model, actions } = stepFloor(this.floor, e, this.floorCfg);
    this.floor = model;
    if (model.state !== before.state || JSON.stringify(model.stats) !== JSON.stringify(before.stats)) this.sendFloor();
    for (const a of actions) this.act(a);
  }

  private sendFloor(): void {
    this.send({ type: 'floor', state: this.floor.state, stats: this.floor.stats });
  }

  private act(a: FloorAction): void {
    switch (a.type) {
      case 'say_far':
        this.outbox.push({ kind: a.kind, text: a.text, ...(a.discloses ? { discloses: true } : {}) });
        if (this.agent) {
          // While the far party is talking, only queue: the agent asks our
          // endpoint when their turn ends, and we answer with the hold line.
          // Otherwise ask it to speak now.
          if (!this.farSpeaking) this.agent.requestReply();
        } else {
          // No Voice Agent: hand it straight to the browser to speak.
          this.flushOutbox();
        }
        break;
      case 'cue_user':
        this.send({ type: 'cue', text: a.text });
        break;
      case 'ask_user':
        this.pendingQuestion = a.question;
        this.send({ type: 'question', question: a.question });
        break;
      case 'run_dissent':
        void this.decide(a.evidence);
        break;
      case 'cancel_outward':
        this.outbox = [];
        this.log('Stop pressed. Nothing further will be said.');
        break;
      case 'escalate':
        this.send({ type: 'escalated', reason: a.reason, packet: this.escalationPacket() });
        break;
      case 'log':
        this.log(a.message);
        break;
    }
  }

  private async decide(evidence: EvidenceBundle): Promise<void> {
    const result = await runDissent(evidence, {
      apiKey: this.opts.apiKey,
      model: this.model ?? this.opts.llmModel,
      context: this.opts.profile.context,
      allowedWords: [this.opts.profile.displayName],
      callerName: this.opts.profile.displayName,
      lexicon: this.opts.lexicon,
      mode: 'parallel',
      live: true,
    });
    this.lastDissent = result;
    this.send({ type: 'dissent', result });

    let question: ForcedChoice | undefined;
    if (result.decision.action === 'ask') {
      question = await buildQuestion({
        result, ev: evidence, lexicon: this.opts.lexicon,
        gateway: { apiKey: this.opts.apiKey, model: result.model },
        callerName: this.opts.profile.displayName,
      });
    }
    this.step({ type: 'dissent', at: this.now(), result, ...(question ? { question } : {}) });
  }

  // ---- the outward channel --------------------------------------------------

  /**
   * Called when the Voice Agent asks our endpoint what to say. Returns only
   * text the Floor Controller queued. Empty means the agent stays silent,
   * which is measured behaviour, not a guess.
   */
  takeApprovedSpeech(): string {
    // MEASURED 18 Sept: the agent can call this endpoint twice for one reply,
    // about half a second apart. Re-sending in-flight lines is then correct and
    // silent; it is only a repeat worth logging after a reply was talked over.
    const resent = this.talkedOver && this.unconfirmed.length > 0;
    this.talkedOver = false;
    this.unconfirmed = this.pending([...this.unconfirmed, ...this.flushOutbox()]);
    // A disclosure on its own is not worth interrupting anyone for. It waits
    // and goes out in front of the next hold or relay.
    if (!this.unconfirmed.some((o) => o.kind !== 'disclosure')) return '';
    if (resent) this.log('Repeating an approved line the far party talked over.');
    this.inFlight = [...this.unconfirmed];
    return this.unconfirmed.map((o) => o.text).join(' ');
  }

  /**
   * Which approved lines are still worth saying. A hold line is only meaningful
   * while the caller is mid-turn and silent: once they are speaking again, it
   * would talk over the very person it exists to protect.
   */
  private pending(items: Outgoing[]): Outgoing[] {
    const callerTalking = this.floor.state === 'USER_SPEAKING';
    return items.filter((o) => o.kind !== 'hold' || (this.floor.userTurnOpen && !callerTalking));
  }

  private worthSayingNow(): boolean {
    return this.outbox.length > 0 || this.pending(this.unconfirmed).some((o) => o.kind !== 'disclosure');
  }

  /**
   * MEASURED 18 Sept: when the far party barges in, transcript.agent carries
   * only the words actually spoken ("Hi, I'm an"). So a line counts as heard
   * only if it appears in full in that transcript. Partial is not heard.
   */
  private markSpoken(text: string): void {
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const said = norm(text);
    this.unconfirmed = this.unconfirmed.filter((o) => !said.includes(norm(o.text)));
  }

  /** Emits every newly approved line once, and returns them. */
  private flushOutbox(): Outgoing[] {
    const items = this.outbox;
    this.outbox = [];
    for (const o of items) this.send({ type: 'outward', kind: o.kind, text: o.text });
    return items;
  }

  // ---- the caller's controls ------------------------------------------------

  choose(questionId: string, optionId: string): void {
    const q = this.pendingQuestion;
    if (!q || q.id !== questionId) return;
    const opt = q.options.find((o) => o.id === optionId);
    if (!opt) return;
    this.pendingQuestion = null;
    this.chosenLabels.push(opt.label);
    this.step({ type: 'choice', at: this.now(), label: opt.relay ?? opt.label });
  }

  somethingElse(): void {
    this.pendingQuestion = null;
    this.step({ type: 'something_else', at: this.now() });
  }

  stop(): void {
    this.step({ type: 'stop', at: this.now() });
  }

  requestHuman(): void {
    this.step({ type: 'escalate_request', at: this.now() });
  }

  // ---- artifacts ------------------------------------------------------------

  escalationPacket(): EscalationPacket {
    const d = this.lastDissent;
    return {
      callId: this.id,
      caller: this.opts.profile.displayName,
      elapsedMs: this.now(),
      established: this.transcript.filter((x) => x.speaker === 'agent').map((x) => ({ text: x.text, at: x.at })),
      unresolved: d?.decision.action === 'ask' ? (d.decision.target ?? d.decision.reason) : null,
      competingReadings: { advocate: d?.advocate?.say ?? null, skeptic: d?.skeptic?.reading ?? null },
      transcript: this.transcript,
      lexiconActive: this.opts.lexicon.map((l) => l.term),
      yesNoReliability: this.opts.profile.yesNoReliability,
      suggestedQuestion: this.pendingQuestion,
    };
  }

  /** Caller audio kept for the self-audit, only with consent. */
  retainedAudio(): Buffer | null {
    return this.opts.retainAudio && this.callerAudio.length ? Buffer.concat(this.callerAudio) : null;
  }

  async end(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (this.tick) clearInterval(this.tick);
    this.agent?.close();
    await Promise.all([this.patient.close(), this.fast.close()]);
    if (this.agentId) await deleteAgent(this.opts.apiKey, this.agentId);
    this.emit('ended');
  }
}
