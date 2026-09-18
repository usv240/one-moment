// Result collection. Each test writes a JSON blob; run-all.js turns the set
// into REPORT.md, which is the artefact we actually care about.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const RESULTS_DIR = path.join(ROOT, 'results');

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
dotenv.config({ path: path.join(ROOT, '..', '..', '.env'), quiet: true });

export function requireKey() {
  const key = process.env.ASSEMBLYAI_API_KEY?.trim();
  if (!key) {
    console.error('\nNo ASSEMBLYAI_API_KEY found.\n');
    console.error('  1. cd spike');
    console.error('  2. cp .env.example .env');
    console.error('  3. paste your key into .env\n');
    console.error('Get a key at https://www.assemblyai.com/app/api-keys');
    console.error('Sign up through the hackathon link in Rules.md first, and accept');
    console.error('cookies, or the free credits will not attach to the account.\n');
    process.exit(1);
  }
  return key;
}

export function fixture(name) {
  const custom = path.join(ROOT, 'fixtures', 'custom', `${name}.wav`);
  if (fs.existsSync(custom)) return custom;

  const generated = path.join(ROOT, 'fixtures', 'generated', `${name}.wav`);
  if (fs.existsSync(generated)) return generated;

  console.error(`\nMissing fixture "${name}.wav".`);
  console.error('Run:  npm run fixtures\n');
  process.exit(1);
}

export function save(testId, result) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const payload = { testId, ranAt: new Date().toISOString(), ...result };
  fs.writeFileSync(
    path.join(RESULTS_DIR, `${testId}.json`),
    JSON.stringify(payload, null, 2)
  );
  return payload;
}

export function load(testId) {
  const file = path.join(RESULTS_DIR, `${testId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Console formatting. Plain ASCII, no colour codes that break in some terminals.
export const hr = () => console.log('-'.repeat(72));

export function header(title, subtitle) {
  console.log('');
  hr();
  console.log(title);
  if (subtitle) console.log(subtitle);
  hr();
}

export function verdict(pass, message) {
  console.log('');
  console.log(pass ? `PASS  ${message}` : `FAIL  ${message}`);
  console.log('');
  return pass;
}

export function kv(label, value, width = 34) {
  console.log(`  ${String(label).padEnd(width)} ${value}`);
}
