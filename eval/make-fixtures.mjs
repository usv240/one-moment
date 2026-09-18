// Generates the far-party test line with Windows SAPI, normalised to 24kHz
// PCM16, which is what the Voice Agent API expects. Launched from Node, the
// same way spike/fixtures/make.js does it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'fixtures');
fs.mkdirSync(dir, { recursive: true });

function say(text, outName, rate = 0) {
  const raw = path.join(dir, `${outName}.raw.wav`);
  const ps = [
    'Add-Type -AssemblyName System.Speech;',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
    "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Gender -eq 'Female' } | Select-Object -First 1;",
    'if ($v) { $s.SelectVoice($v.VoiceInfo.Name) };',
    `$s.Rate = ${rate};`,
    `$s.SetOutputToWaveFile('${raw.replace(/'/g, "''")}');`,
    `$s.Speak('${text.replace(/'/g, "''")}');`,
    '$s.Dispose();',
  ].join(' ');
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'pipe' });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le',
    path.join(dir, `${outName}.wav`)], { stdio: 'pipe' });
  fs.rmSync(raw, { force: true });
  console.log('  wrote', `${outName}.wav`);
}

say('Hello? Are you there?', 'pharmacist-hello-24k');
say('Okay. Which medicine is it about?', 'pharmacist-which-24k');
say('Thank you. Let me check that for you.', 'pharmacist-thanks-24k');
