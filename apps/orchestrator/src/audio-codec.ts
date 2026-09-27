// The telephone network's audio format, and the conversions a phone call needs.
//
// A PSTN call is 8kHz, 8-bit mu-law (G.711): band-limited and logarithmically
// companded, which is why a phone sounds like a phone. Twilio Media Streams
// hands it over exactly that way, base64 inside JSON, 20ms at a time.
//
// Everything inside One Moment is linear PCM16: 16kHz for the caller's ears,
// 24kHz for the Voice Agent's speech. So a phone leg is four conversions, and
// they all live here, as pure functions over buffers, because the one thing
// worse than no phone support is phone support that quietly corrupts what a
// person said.
//
// Resampling is linear interpolation. The rates involved are simple ratios of
// each other and the signal is already band-limited to 3.4kHz by the network,
// so the usual anti-aliasing argument does not bite: there is nothing above
// 4kHz left in the audio to alias.

const MU = 0xff;
const BIAS = 0x84;
const CLIP = 32635;

/** One linear PCM16 sample to one mu-law byte (G.711). */
export function encodeMulawSample(sample: number): number {
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & MU;
}

/** One mu-law byte back to linear PCM16. */
export function decodeMulawSample(byte: number): number {
  byte = ~byte & MU;
  const sign = byte & 0x80;
  const exponent = (byte >> 4) & 0x07;
  const mantissa = byte & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  // G.711 has two zeros, 0x7F and 0xFF. Both decode to zero, and negative zero
  // is a value that compares oddly downstream, so it is normalised away here.
  return sign !== 0 && sample !== 0 ? -sample : sample;
}

/** A whole buffer of mu-law to 8kHz PCM16. */
export function mulawToPcm(mulaw: Buffer): Buffer {
  const out = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) out.writeInt16LE(decodeMulawSample(mulaw[i]!), i * 2);
  return out;
}

/** A whole buffer of PCM16 to mu-law. */
export function pcmToMulaw(pcm: Buffer): Buffer {
  const out = Buffer.alloc(Math.floor(pcm.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = encodeMulawSample(pcm.readInt16LE(i * 2));
  return out;
}

/**
 * Resample PCM16 between two rates, by linear interpolation.
 *
 * Carries no state between calls, so a stream must be resampled in whole
 * frames. Every rate pair this project uses divides evenly into 20ms, so a
 * frame boundary is always a sample boundary and nothing is lost at the seam.
 */
export function resample(pcm: Buffer, from: number, to: number): Buffer {
  if (from === to) return pcm;
  const inCount = Math.floor(pcm.length / 2);
  if (inCount === 0) return Buffer.alloc(0);
  const outCount = Math.max(1, Math.round((inCount * to) / from));
  const out = Buffer.alloc(outCount * 2);
  const step = (inCount - 1) / Math.max(1, outCount - 1);
  for (let i = 0; i < outCount; i++) {
    const pos = i * step;
    const a = Math.floor(pos);
    const b = Math.min(inCount - 1, a + 1);
    const frac = pos - a;
    const s = pcm.readInt16LE(a * 2) * (1 - frac) + pcm.readInt16LE(b * 2) * frac;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s))), i * 2);
  }
  return out;
}

/** The phone's audio, as the caller's ears expect it: 8kHz mu-law to 16kHz PCM16. */
export const phoneToCaller = (mulaw: Buffer): Buffer => resample(mulawToPcm(mulaw), 8000, 16000);

/** Anything One Moment plays, as the phone expects it: PCM16 at `rate` to 8kHz mu-law. */
export const toPhone = (pcm: Buffer, rate: number): Buffer => pcmToMulaw(resample(pcm, rate, 8000));

/**
 * Repacks a stream into fixed-size frames.
 *
 * Twilio speaks in 20ms; the listening streams want 50ms; neither divides the
 * other. Audio that arrives in the wrong size has to be re-cut rather than
 * padded, because padding a live stream with silence is how a turn detector
 * gets told someone stopped talking when they did not.
 */
export class Framer {
  private buf: Buffer = Buffer.alloc(0);
  private readonly frameBytes: number;
  constructor(frameBytes: number) {
    this.frameBytes = frameBytes;
  }
  push(chunk: Buffer): Buffer[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: Buffer[] = [];
    while (this.buf.length >= this.frameBytes) {
      out.push(this.buf.subarray(0, this.frameBytes));
      this.buf = this.buf.subarray(this.frameBytes);
    }
    return out;
  }
  /** Whatever is left, padded once, for the end of a stream only. */
  flush(): Buffer | null {
    if (!this.buf.length) return null;
    const last = Buffer.concat([this.buf, Buffer.alloc(this.frameBytes - this.buf.length)]);
    this.buf = Buffer.alloc(0);
    return last;
  }
}
