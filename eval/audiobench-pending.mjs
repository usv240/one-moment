// How many streamed sentences still have no cached decision. Exit code 0 when
// every sentence is decided and every stream log says done; 1 otherwise.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const ids = new Set(fs.readdirSync(dir).filter((f) => /^audiobench-evidence.*\.json$/.test(f))
  .flatMap((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).rows.map((r) => r.id); } catch { return []; } }));
const cache = fs.existsSync(path.join(dir, 'audiobench-decisions.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'audiobench-decisions.json'), 'utf8')) : {};
const pending = [...ids].filter((id) => !cache[id]).length;
const streaming = fs.readdirSync(dir).filter((f) => /^audiobench-stream-.*\.log$/.test(f)).some((f) => !/^done$/m.test(fs.readFileSync(path.join(dir, f), 'utf8')));
console.log(`${ids.size} streamed, ${ids.size - pending} decided, ${pending} pending${streaming ? ', still streaming' : ''}`);
process.exit(pending === 0 && !streaming ? 0 : 1);
