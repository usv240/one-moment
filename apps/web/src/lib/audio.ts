'use client';

// Browser audio: microphone capture out, gapless playback in.
//
// Server audio frames carry a one-byte channel header:
//   1 = caller (16kHz), 2 = far party (24kHz), 3 = the agent's voice (24kHz).

export type Capture = { stop: () => void };

export async function startCapture(opts: {
  targetRate: 16000 | 24000;
  onFrame: (pcm: ArrayBuffer) => void;
  onLevel?: (rms: number) => void;
}): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('/pcm-worklet.js');
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-capture', { processorOptions: { targetRate: opts.targetRate } });
  node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
    opts.onFrame(e.data.pcm);
    opts.onLevel?.(e.data.rms);
  };
  source.connect(node);
  // The node must reach a destination to be pulled, but must not be audible.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);
  return {
    stop: () => {
      node.port.onmessage = null;
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

const RATES: Record<number, number> = { 1: 16000, 2: 24000, 3: 24000 };

/**
 * Plays PCM16 frames from several channels without gaps or overlap within a
 * channel. Each channel keeps its own playhead so the agent's voice and the far
 * party can overlap naturally, as they would on a real line.
 */
export class Player {
  private ctx: AudioContext;
  private heads = new Map<number, number>();
  private sources = new Map<number, Set<AudioBufferSourceNode>>();
  private gain: GainNode;
  /** Level per channel, for the UI. */
  onLevel?: (channel: number, rms: number) => void;

  constructor() {
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  play(frame: ArrayBuffer): void {
    const bytes = new Uint8Array(frame);
    const channel = bytes[0]!;
    const rate = RATES[channel];
    if (!rate || bytes.length < 3) return;
    const pcm = new Int16Array(frame.slice(1));
    const f32 = new Float32Array(pcm.length);
    let sq = 0;
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i]! / 0x8000;
      f32[i] = v;
      sq += v * v;
    }
    this.onLevel?.(channel, Math.sqrt(sq / Math.max(1, pcm.length)));

    const buf = this.ctx.createBuffer(1, f32.length, rate);
    buf.copyToChannel(f32, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    const now = this.ctx.currentTime;
    // A small lead absorbs network jitter. If a channel fell behind, catch up.
    let at = this.heads.get(channel) ?? now + 0.08;
    if (at < now) at = now + 0.03;
    src.start(at);
    this.heads.set(channel, at + buf.duration);
    const live = this.sources.get(channel) ?? new Set();
    live.add(src);
    this.sources.set(channel, live);
    src.onended = () => live.delete(src);
  }

  /** Stop everything playing or queued on one channel, now. */
  flush(channel: number): void {
    for (const src of this.sources.get(channel) ?? []) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this.sources.get(channel)?.clear();
    this.heads.delete(channel);
  }

  setMuted(muted: boolean): void {
    this.gain.gain.value = muted ? 0 : 1;
  }

  close(): void {
    void this.ctx.close();
  }
}

/** Last-resort outward voice when no Voice Agent is available. Clearly labelled in the UI. */
export function speakInBrowser(text: string): void {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch {
    /* not supported: the text is still shown on screen */
  }
}
