// Minimal 16-bit PCM WAV reader and writer. No dependencies.
// Everything in this spike is 16kHz, mono, signed 16-bit little endian.

import fs from 'node:fs';

export const SAMPLE_RATE = 16000;
export const BYTES_PER_SAMPLE = 2;

/**
 * Read a WAV file and return { sampleRate, channels, pcm } where pcm is a
 * Buffer of signed 16-bit little endian samples.
 * Throws if the file is not 16-bit PCM.
 */
export function readWav(path) {
  const buf = fs.readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path} is not a RIFF/WAVE file`);
  }

  let offset = 12;
  let fmt = null;
  let dataStart = null;
  let dataLength = null;

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataStart = body;
      dataLength = Math.min(size, buf.length - body);
    }

    offset = body + size + (size % 2); // chunks are word aligned
  }

  if (!fmt) throw new Error(`${path} has no fmt chunk`);
  if (dataStart === null) throw new Error(`${path} has no data chunk`);
  if (fmt.bitsPerSample !== 16) {
    throw new Error(`${path} is ${fmt.bitsPerSample}-bit. This spike needs 16-bit PCM.`);
  }

  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    pcm: buf.subarray(dataStart, dataStart + dataLength),
  };
}

/** Write a Buffer of 16-bit LE mono samples as a WAV file. */
export function writeWav(path, pcm, sampleRate = SAMPLE_RATE) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * BYTES_PER_SAMPLE;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);          // PCM fmt chunk size
  header.writeUInt16LE(1, 20);           // format = PCM
  header.writeUInt16LE(1, 22);           // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32); // block align
  header.writeUInt16LE(16, 34);          // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  fs.writeFileSync(path, Buffer.concat([header, pcm]));
}

/** A Buffer of digital silence, `ms` milliseconds long. */
export function silence(ms, sampleRate = SAMPLE_RATE) {
  return Buffer.alloc(Math.round((ms / 1000) * sampleRate) * BYTES_PER_SAMPLE);
}

export function durationMs(pcm, sampleRate = SAMPLE_RATE) {
  return (pcm.length / BYTES_PER_SAMPLE / sampleRate) * 1000;
}

/**
 * Split PCM into fixed-duration frames.
 * 50ms at 16kHz mono is 800 samples, 1600 bytes.
 */
export function toFrames(pcm, frameMs = 50, sampleRate = SAMPLE_RATE) {
  const frameBytes = Math.round((frameMs / 1000) * sampleRate) * BYTES_PER_SAMPLE;
  const frames = [];
  for (let i = 0; i < pcm.length; i += frameBytes) {
    let frame = pcm.subarray(i, i + frameBytes);
    if (frame.length < frameBytes) {
      frame = Buffer.concat([frame, Buffer.alloc(frameBytes - frame.length)]);
    }
    frames.push(frame);
  }
  return frames;
}
