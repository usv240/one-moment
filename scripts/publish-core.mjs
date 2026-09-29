// Stage and publish @one-moment/core, without touching how the repository works.
//
// Two facts force this shape. Node refuses to strip types for anything under
// node_modules, so a package cannot ship TypeScript source and be usable; only
// installing the tarball reveals that. And npm does not apply publishConfig
// field overrides at pack time, so the published manifest cannot simply be a
// variation of the workspace one.
//
// So the published package is built here from its own manifest, in a staging
// directory. The repository keeps resolving source, the website build keeps
// working, and nothing that is already deployed depends on this running.
//
//   node scripts/publish-core.mjs          # stage and verify, publish nothing
//   node scripts/publish-core.mjs --publish

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const core = path.join(repo, 'packages', 'core');
const stage = path.join(repo, 'packages', 'core', '.publish');
// No shell: this repository lives under a path with spaces, and a shell splits
// it into arguments that tsc reads as flags.
// Node refuses to spawn a .cmd without a shell, and npm on Windows is one, so
// npm gets a shell and every argument passed to it is kept free of spaces.
// The compiler gets no shell, because a shell would split this repository's own
// path on its spaces and read the pieces as flags.
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const npm = (args, opts = {}) => execFileSync('npm', args, { stdio: 'inherit', shell: true, ...opts });
const tsc = (project) => run(process.execPath, [path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', project]);

// 1. Build the JavaScript and the declarations a consumer actually needs.
tsc(path.join(core, 'tsconfig.build.json'));
if (!fs.existsSync(path.join(core, 'dist', 'index.js'))) throw new Error('build produced no dist/index.js');

// 2. Stage: dist, the readme, the licence, and a manifest that points at dist.
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(path.join(core, 'dist'), path.join(stage, 'dist'), { recursive: true });
fs.copyFileSync(path.join(core, 'README.md'), path.join(stage, 'README.md'));
fs.copyFileSync(path.join(repo, 'LICENSE'), path.join(stage, 'LICENSE'));

const src = JSON.parse(fs.readFileSync(path.join(core, 'package.json'), 'utf8'));
const manifest = {
  name: src.name,
  version: src.version,
  type: 'module',
  license: src.license,
  description: src.description,
  keywords: src.keywords,
  homepage: src.homepage,
  repository: src.repository,
  bugs: src.bugs,
  engines: src.engines,
  sideEffects: false,
  types: './dist/index.d.ts',
  main: './dist/index.js',
  exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
  publishConfig: { access: 'public' },
};
fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// 3. Prove the staged package works the way a stranger would use it, before it
//    is published rather than after.
const check = path.join(stage, '..', '.publish-check');
fs.rmSync(check, { recursive: true, force: true });
fs.mkdirSync(check, { recursive: true });
fs.writeFileSync(path.join(check, 'package.json'), JSON.stringify({ name: 'check', private: true, type: 'module' }, null, 2));
npm(['install', path.relative(check, stage).split(path.sep).join('/'), '--no-audit', '--no-fund'], { cwd: check, stdio: 'pipe' });
fs.writeFileSync(path.join(check, 'use.mjs'), `
import { assembleEvidence, runDissent, POLICY_RULES, VOICES } from '@one-moment/core';
const words = 'I need to refill my amlodipine prescription, please.'.split(' ').map((text, i) => ({ text, start: i * 400, end: i * 400 + 320, confidence: 0.99, word_is_final: true }));
const turn = { type: 'Turn', turn_order: 0, end_of_turn: true, turn_is_formatted: true, transcript: 'I need to refill my amlodipine prescription, please.', words };
const res = await runDissent(assembleEvidence({ patient: turn }), { apiKey: '', callerName: 'Robert', lexicon: [], live: false });
if (res.decision.action !== 'relay') throw new Error('expected a clear sentence to be relayed, got ' + res.decision.action);
if (!VOICES.length || !POLICY_RULES[9]) throw new Error('exports missing');
console.log('  installed package works: ' + res.decision.action + ' by rule ' + res.decision.policyRule + ', ' + JSON.stringify(res.decision.text));
`);
run('node', ['use.mjs'], { cwd: check });

console.log(`\nstaged ${manifest.name}@${manifest.version} at ${path.relative(repo, stage)}`);
if (process.argv.includes('--publish')) {
  npm(['publish'], { cwd: stage });
  console.log('published');
} else {
  console.log('dry run. To publish: npm login, create the one-moment org, then rerun with --publish');
}
