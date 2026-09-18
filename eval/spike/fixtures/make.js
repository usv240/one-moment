// Generates deterministic test audio with exactly known silence gaps.
//
// A synthetic fixture is better than a real recording for this purpose: we need
// to know the gap is exactly 6000ms, not roughly six seconds, so that a failed
// patience test is unambiguous.
//
// Uses Windows SAPI for speech and ffmpeg to normalise to 16kHz mono PCM16.
// If you would rather use your own voice, drop 16kHz mono WAV files into
// fixtures/custom/ and the tests will prefer them. See README.md.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWav, writeWav, silence, durationMs, SAMPLE_RATE, BYTES_PER_SAMPLE } from '../lib/wav.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(here, '.tmp');
const out = path.join(here, 'generated');

fs.mkdirSync(tmp, { recursive: true });
fs.mkdirSync(out, { recursive: true });

/** Speak text to a WAV via Windows SAPI, then normalise to 16kHz mono PCM16. */
function say(text, name, { rate = -2 } = {}) {
  const rawPath = path.join(tmp, `${name}.raw.wav`);
  const normPath = path.join(tmp, `${name}.16k.wav`);

  const ps = [
    'Add-Type -AssemblyName System.Speech;',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
    `$s.Rate = ${rate};`,
    `$s.SetOutputToWaveFile('${rawPath.replace(/'/g, "''")}');`,
    `$s.Speak('${text.replace(/'/g, "''")}');`,
    '$s.Dispose();',
  ].join(' ');

  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'pipe' });
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', rawPath,
    '-ar', String(SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le',
    normPath,
  ], { stdio: 'pipe' });

  return trimSilence(readWav(normPath).pcm);
}

/** Trim near-silence from both ends so spliced gaps are exactly the length we ask for. */
function trimSilence(pcm, threshold = 350) {
  const n = pcm.length / BYTES_PER_SAMPLE;
  let first = 0;
  let last = n - 1;
  while (first < n && Math.abs(pcm.readInt16LE(first * BYTES_PER_SAMPLE)) < threshold) first++;
  while (last > first && Math.abs(pcm.readInt16LE(last * BYTES_PER_SAMPLE)) < threshold) last--;
  if (first >= last) return pcm;
  // Keep 30ms of headroom either side so we do not clip the onset.
  const pad = Math.round(0.03 * SAMPLE_RATE);
  const s = Math.max(0, first - pad);
  const e = Math.min(n - 1, last + pad);
  return pcm.subarray(s * BYTES_PER_SAMPLE, (e + 1) * BYTES_PER_SAMPLE);
}

function build(name, parts) {
  const pcm = Buffer.concat(parts);
  const file = path.join(out, `${name}.wav`);
  writeWav(file, pcm);
  console.log(`  ${name}.wav  ${(durationMs(pcm) / 1000).toFixed(2)}s`);
  return file;
}

console.log('Generating fixtures. This takes about 30 seconds.\n');

// Leading silence on every fixture. Streaming recognisers behave badly if the
// very first frame is speech, and a real call always has a moment of room tone.
const lead = silence(400);

// 1. The headline test. A word-finding block of exactly 6 seconds mid-sentence.
const a1 = say('I need to refill my', 'a1');
const a2 = say('amlodipine prescription please', 'a2');
build('pause-6s', [lead, a1, silence(6000), a2, silence(800)]);

// 2. The control. Same words, 2 second gap. Should close the turn on defaults
//    and stay open on the patient configuration.
build('pause-2s', [lead, a1, silence(2000), a2, silence(800)]);

// 3. Negation. The highest-consequence error class in the product. If the
//    recogniser or the model drops the "not", the meaning inverts.
const b1 = say('the white one', 'b1');
const b2 = say('heart', 'b2');
const b3 = say('not refill', 'b3');
build('negation', [lead, b1, silence(1800), b2, silence(2600), b3, silence(800)]);

// 4. Lexicon target. A drug name in a short carrier phrase, for the keyterms
//    bias test. Spoken faster so it is less clearly articulated.
const c1 = say('I need my amlodipine and my metformin', 'c1', { rate: 1 });
build('lexicon', [lead, c1, silence(800)]);

// 5. Fluent control with no long gap, to confirm nothing is broken at baseline.
const d1 = say('Hello, I am calling about my prescription.', 'd1', { rate: 0 });
build('control', [lead, d1, silence(800)]);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nDone. Fixtures are in fixtures/generated/');
console.log('To use your own voice instead, see spike/README.md.');
