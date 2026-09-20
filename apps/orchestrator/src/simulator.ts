// The simulated parties, so a judge can hear a complete call with no
// microphone and no second person.
//
//  - Caller (sample mode only): a recorded caller with a real 6-second
//    word-finding pause, streamed in real time into both listening streams.
//  - Pharmacist (both modes): speaks up when the caller has been silent
//    mid-turn for a while, exactly the moment the product exists for, then
//    thanks them once the relay has been heard.
//
// Everything here is labelled as simulated in the UI. The AssemblyAI side is
// not simulated: the streams, the Voice Agent and the Adjudicator are live.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scenario, ServerMessage } from '@one-moment/core';
import type { Call } from './call.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.resolve(here, '../../../eval/fixtures');

/** Each recorded caller, and what a listener is told they are hearing. */
const FIXTURE: Record<Scenario, string> = {
  pause: 'caller-pause-6s.wav',
  choice: 'caller-choice-6s.wav',
  dissent: 'caller-dissent-6s.wav',
};
export const isScenario = (x: unknown): x is Scenario => typeof x === 'string' && x in FIXTURE;

const STARTED: Record<Scenario, string> = {
  pause: 'Recorded caller, synthetic voice, with a real 6-second pause.',
  choice: 'Recorded caller, synthetic voice: a 6-second pause, then the medicine name slurred.',
  dissent: 'Recorded caller, synthetic voice: a sentence that stops before its last word, so both models have to read it.',
};

function readPcm(file: string): Buffer {
  const b = fs.readFileSync(file);
  let o = 12;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'data') return b.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size % 2);
  }
  throw new Error(`no audio data in ${file}`);
}

const CALLER_FRAME = 1600; // 50ms at 16kHz PCM16
const FAR_FRAME = 2400;    // 50ms at 24kHz PCM16

export class Simulator {
  private call: Call;
  private playCaller: boolean;
  private callerPcm: Buffer | null;
  private hello: Buffer;
  private thanks: Buffer;
  private callerPos = 0;
  private farQueue: Buffer[] = [];
  private timer: NodeJS.Timeout | null = null;
  private helloPlayed = false;
  private thanksPlayed = false;
  private tick = 0;
  private start = 0;
  private sampleEndedAt: number | null = null;
  private onMsg = (m: ServerMessage) => this.react(m);
  private onAudio = (channel: string, pcm: Buffer) => { if (channel === 'caller') this.listen(pcm); };
  // What the pharmacist can hear of the caller: how much speech, how much silence since.
  private voicedMs = 0;
  private silentMs = 0;
  private turnOpen = false;

  private scenario: Scenario;
  private chose = false;

  constructor(call: Call, opts: { playCaller: boolean; scenario?: Scenario }) {
    this.call = call;
    this.playCaller = opts.playCaller;
    this.scenario = opts.scenario ?? 'pause';
    const fixture = FIXTURE[this.scenario];
    this.callerPcm = opts.playCaller ? readPcm(path.join(FIXTURES, fixture)) : null;
    this.hello = readPcm(path.join(FIXTURES, 'pharmacist-hello-24k.wav'));
    this.thanks = readPcm(path.join(FIXTURES, 'pharmacist-thanks-24k.wav'));
  }

  run(): void {
    this.call.on('message', this.onMsg);
    this.call.on('audio', this.onAudio);
    this.start = Date.now();
    if (this.playCaller) {
      this.call.note('caller_sample_started', STARTED[this.scenario]);
    }
    // Drift-corrected 50ms clock: turn detection depends on wall-clock silence.
    const step = () => {
      this.frame();
      this.tick++;
      const due = this.start + this.tick * 50;
      this.timer = setTimeout(step, Math.max(0, due - Date.now()));
    };
    step();
  }

  private frame(): void {
    if (this.callerPcm) {
      const c = this.callerPcm.subarray(this.callerPos, this.callerPos + CALLER_FRAME);
      this.callerPos += CALLER_FRAME;
      // Keep sending silence after the recording ends: the streams need to hear
      // the silence to decide the turn is over.
      this.call.callerFrame(c.length === CALLER_FRAME ? c : Buffer.alloc(CALLER_FRAME));
      if (c.length < CALLER_FRAME && this.sampleEndedAt === null) {
        this.sampleEndedAt = Date.now();
        this.call.note('caller_sample_ended');
      }
    }
    // The far party is always "on the line": silence unless it is speaking.
    this.call.farFrame(this.farQueue.shift() ?? Buffer.alloc(FAR_FRAME));
  }

  private say(pcm: Buffer, text: string): void {
    for (let i = 0; i < pcm.length; i += FAR_FRAME) {
      const f = pcm.subarray(i, i + FAR_FRAME);
      this.farQueue.push(f.length === FAR_FRAME ? f : Buffer.concat([f, Buffer.alloc(FAR_FRAME - f.length)]));
    }
    this.call.note('pharmacist_spoke', text);
  }

  /**
   * The pharmacist listens to the caller the way a person on the phone does: by
   * ear, not by our turn detector. After 1.2 seconds of silence mid-sentence
   * they fill it. Gaps beyond about 700ms already read as trouble in ordinary
   * conversation (Stivers et al. 2009), so 1.2 seconds is a patient pharmacist.
   */
  private listen(pcm: Buffer): void {
    let sq = 0;
    for (let i = 0; i + 1 < pcm.length; i += 2) { const v = pcm.readInt16LE(i) / 32768; sq += v * v; }
    const rms = Math.sqrt(sq / Math.max(1, pcm.length / 2));
    const ms = (pcm.length / 2 / 16000) * 1000;
    if (rms > 0.015) { this.voicedMs += ms; this.silentMs = 0; } else this.silentMs += ms;
    if (!this.helloPlayed && this.turnOpen && this.voicedMs >= 300 && this.silentMs >= 1200) {
      this.helloPlayed = true;
      this.say(this.hello, 'Hello? Are you there?');
    }
  }

  private react(m: ServerMessage): void {
    // The recorded caller cannot tap a screen, so in the choice scenario a
    // simulated tap answers the question after a human-length pause. Labelled.
    if (m.type === 'question' && this.playCaller && this.scenario !== 'pause' && !this.chose) {
      this.chose = true;
      const q = m.question;
      const pick = q.options[0]!;
      setTimeout(() => {
        this.call.note('caller_chose', pick.label);
        this.call.choose(q.id, pick.id);
      }, 3000);
    }
    if (m.type === 'floor') this.turnOpen = m.state === 'USER_SPEAKING' || m.state === 'USER_PAUSED';
    // Fallback: if the caller's audio is too quiet to judge, the Floor
    // Controller's own pause state still prompts the pharmacist.
    if (m.type === 'floor' && m.state === 'USER_PAUSED' && !this.helloPlayed) {
      this.helloPlayed = true;
      this.say(this.hello, 'Hello? Are you there?');
    }
    // The relay has been heard: the pharmacist responds, and the call is done.
    if (m.type === 'agent_spoke' && /says:|asking|wants|would like|about/i.test(m.text) && !this.thanksPlayed) {
      this.thanksPlayed = true;
      setTimeout(() => {
        this.say(this.thanks, 'Thank you. Let me check that for you.');
        setTimeout(() => this.call.note('call_complete'), 4500);
      }, 900);
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.call.off('message', this.onMsg);
    this.call.off('audio', this.onAudio);
  }
}
