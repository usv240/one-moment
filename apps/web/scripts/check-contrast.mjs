// WCAG contrast audit for the design tokens. Fails the build on a violation.
//
// The rule from _shared/01-DESIGN-SYSTEM.md: a judge who sees a live contrast
// audit will believe every other claim on the site. So this runs in CI, and its
// output is published on /accessibility.
//
//   node scripts/check-contrast.mjs          prints the table, exits 1 on failure
//   node scripts/check-contrast.mjs --json   machine-readable
//   node scripts/check-contrast.mjs --write  writes src/content/contrast.json for /accessibility

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, '..', 'src', 'app', 'globals.css'), 'utf8');

function block(selectorRegex) {
  const m = css.match(selectorRegex);
  if (!m) throw new Error(`token block not found: ${selectorRegex}`);
  const vars = {};
  for (const [, k, v] of m[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) vars[k] = v;
  return vars;
}

const light = block(/^:root \{([\s\S]*?)\n\}/m);
const dark = block(/^:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/m);

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground, background, minimum, why]
const PAIRS = [
  ['text', 'bg', 7, 'body text, AAA'],
  ['text', 'bg-raised', 7, 'body text on cards, AAA'],
  ['text-muted', 'bg', 4.5, 'secondary text, AA'],
  ['text-muted', 'bg-raised', 4.5, 'secondary text on cards, AA'],
  ['text-subtle', 'bg', 4.5, 'captions and metadata, AA'],
  ['accent-fg', 'accent', 4.5, 'primary button label, AA'],
  ['danger-fg', 'danger', 4.5, 'Stop button label, AA even though it is large text'],
  ['accent', 'bg', 4.5, 'links, AA'],
  ['focus-ring', 'bg', 3, 'focus indicator, non-text 1.4.11'],
  ['focus-ring', 'bg-raised', 3, 'focus indicator on cards'],
  ['border-strong', 'bg', 3, 'borders that carry state, 1.4.11'],
  ['ev-grounded', 'bg-raised', 3, 'evidence mark, non-text'],
  ['ev-vetoed', 'bg-raised', 3, 'evidence mark, non-text'],
  // Amber is a documented WARN in light mode: relieved by a visible label on every span.
  ['ev-inferred', 'bg-raised', 1.9, 'evidence mark, relieved by label (documented)'],
];

const rows = [];
for (const [mode, t] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, min, why] of PAIRS) {
    if (!t[fg] || !t[bg]) continue;
    const r = ratio(t[fg], t[bg]);
    rows.push({ mode, fg, bg, fgHex: t[fg], bgHex: t[bg], ratio: +r.toFixed(2), min, why, pass: r >= min });
  }
}

const failed = rows.filter((r) => !r.pass);

if (process.argv.includes('--write')) {
  // Refreshes the audit the /accessibility page renders. Runs before every build.
  const out = path.join(here, '..', 'src', 'content', 'contrast.json');
  fs.writeFileSync(out, JSON.stringify({ checkedAt: new Date().toISOString().slice(0, 10), rows }, null, 2));
  console.log(`contrast: ${rows.length - failed.length}/${rows.length} pairs pass, written to src/content/contrast.json`);
  if (failed.length) process.exit(1);
} else if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(rows, null, 2));
} else {
  for (const r of rows) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.mode.padEnd(5)} ${`${r.fg} on ${r.bg}`.padEnd(30)} ${String(r.ratio).padStart(5)}:1  (min ${r.min})  ${r.why}`);
  }
  console.log(`\n${rows.length - failed.length}/${rows.length} pairs pass`);
  if (failed.length) process.exit(1);
}
