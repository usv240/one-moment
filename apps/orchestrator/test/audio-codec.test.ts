import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeMulawSample, encodeMulawSample, Framer, mulawToPcm, pcmToMulaw, phoneToCaller, resample, toPhone,
} from '../src/audio-codec.ts';

const tone = (samples: number, rate: number, hz = 440, amp = 12000) => {
  const b = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(amp * Math.sin((2 * Math.PI * hz * i) / rate)), i * 2);
  return b;
};
/** How far apart two signals are, as a fraction of full scale. */
const rmsError = (a: Buffer, b: Buffer) => {
  const n = Math.min(a.length, b.length) / 2;
  let sq = 0;
  for (let i = 0; i < n; i++) { const d = (a.readInt16LE(i * 2) - b.readInt16LE(i * 2)) / 32768; sq += d * d; }
  return Math.sqrt(sq / n);
};

// mu-law is lossy by design, but it must be lossy in the ordinary way: every
// byte decodes to something close to what was encoded, and loudly wrong
// samples would be audible as clicks in the middle of someone's words.
test('mu-law survives a round trip within its own quantisation', () => {
  for (const s of [0, 1, -1, 100, -100, 1000, -1000, 8000, -8000, 32767, -32768]) {
    const back = decodeMulawSample(encodeMulawSample(s));
    const tolerance = Math.max(8, Math.abs(s) * 0.09); // G.711 is logarithmic: error grows with level
    assert.ok(Math.abs(back - s) <= tolerance, `${s} came back as ${back}`);
  }
  const signal = tone(800, 8000);
  assert.ok(rmsError(mulawToPcm(pcmToMulaw(signal)), signal) < 0.01, 'a tone should survive G.711 nearly intact');
});

// G.711 defines two zeros, 0x7F and 0xFF. Every other byte is its own round
// trip; without that exception this test would be asserting a bug into the codec.
test('every mu-law byte decodes and re-encodes to itself, but for the two zeros', () => {
  const zeros = new Set([0x7f, 0xff]);
  for (let b = 0; b < 256; b++) {
    if (zeros.has(b)) { assert.equal(decodeMulawSample(b), 0, `byte ${b} is a zero`); continue; }
    assert.equal(encodeMulawSample(decodeMulawSample(b)), b, `byte ${b}`);
  }
  assert.ok(!Object.is(decodeMulawSample(0x7f), -0), 'and neither zero is negative zero');
});

// Twilio speaks 20ms of 8kHz mu-law, which is 160 bytes. Getting the sample
// counts wrong is how audio ends up chipmunked or slowed, and a turn detector
// reading stretched audio would mistime every pause in the call.
test('a phone frame arrives at the listening streams as the right amount of audio', () => {
  const frame = Buffer.alloc(160, 0xff); // 20ms of mu-law
  const pcm = phoneToCaller(frame);
  assert.equal(pcm.length / 2, 320, '20ms at 16kHz is 320 samples');
  const back = toPhone(pcm, 16000);
  assert.equal(back.length, 160, 'and 20ms of mu-law on the way back');
});

test('the agent at 24kHz reaches the phone at the right duration', () => {
  const ms = 20;
  const agent = tone((24000 * ms) / 1000, 24000);
  assert.equal(toPhone(agent, 24000).length, (8000 * ms) / 1000);
});

test('resampling preserves the signal, not just the sample count', () => {
  const at8k = tone(8000, 8000, 300);
  const round = resample(resample(at8k, 8000, 16000), 16000, 8000);
  assert.equal(round.length, at8k.length);
  assert.ok(rmsError(round, at8k) < 0.02, 'a 300Hz tone should survive 8k to 16k and back');
});

test('silence stays silent and never becomes noise', () => {
  const quiet = Buffer.alloc(320);
  const out = mulawToPcm(toPhone(quiet, 8000));
  for (let i = 0; i < out.length; i += 2) assert.ok(Math.abs(out.readInt16LE(i)) < 64, 'silence must stay silent');
});

// 20ms in, 50ms out: the frame sizes do not divide each other, so the stream
// has to be re-cut rather than padded. Padding a live stream with silence tells
// the turn detector the caller stopped when they had not.
test('a 20ms phone stream is re-cut into 50ms frames with nothing lost', () => {
  const framer = new Framer(1600); // 50ms of 16kHz PCM16
  let produced = 0;
  for (let i = 0; i < 11; i++) produced += framer.push(Buffer.alloc(640)).length; // 20ms of 16kHz PCM16
  assert.equal(produced, 4, '220ms of audio yields four whole 50ms frames');
  assert.equal(framer.flush()!.length, 1600, 'the 20ms remainder is padded once, at the end only');
  assert.equal(framer.flush(), null, 'and nothing is invented afterwards');
});

test('the framer never drops or duplicates a sample', () => {
  const framer = new Framer(100);
  const chunks = [37, 5, 250, 1, 99].map((n, i) => Buffer.alloc(n, i + 1));
  const out = chunks.flatMap((c) => framer.push(c));
  const tail = framer.flush();
  const total = Buffer.concat(tail ? [...out, tail] : out);
  const sent = Buffer.concat(chunks);
  assert.deepEqual(total.subarray(0, sent.length), sent, 'every byte comes out in order');
});
