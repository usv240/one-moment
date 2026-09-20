// Automated accessibility audit of every page, in both themes, with axe-core.
// Writes src/content/axe.json, which the /accessibility page renders as-is,
// violations included.
//
// Needs the site running (npm run dev or npm start) and a local Chrome.
//   node scripts/axe-audit.mjs [http://localhost:3000]

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const base = process.argv[2] ?? 'http://localhost:3000';
// '/replay?call=dissent' is listed separately because it renders the full
// engine view rather than the compact one, so it is a different page to audit.
const PAGES = ['/', '/demo', '/replay', '/replay?call=dissent', '/setup', '/api', '/judges', '/technology', '/evidence', '/limits', '/glossary', '/accessibility'];
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME });
const pages = [];
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
  for (const p of PAGES) {
    const page = await ctx.newPage();
    await page.goto(base + p, { waitUntil: 'networkidle' });
    await page.addScriptTag({ content: axeSource });
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
      return {
        passes: res.passes.length,
        violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) })),
      };
    });
    pages.push({ path: p, scheme, ...r });
    console.log(`${scheme.padEnd(5)} ${p.padEnd(15)} passes ${String(r.passes).padStart(3)}  violations ${r.violations.length}${r.violations.length ? '  ' + r.violations.map((v) => `${v.id}(${v.nodes}) ${v.targets.join(' | ')}`).join('; ') : ''}`);
    await page.close();
  }
  await ctx.close();
}
await browser.close();

const { version } = require('axe-core/package.json');
fs.writeFileSync(path.join(here, '..', 'src', 'content', 'axe.json'), JSON.stringify({
  checkedAt: new Date().toISOString().slice(0, 10),
  tool: `axe-core ${version} (WCAG 2.2 AA and best-practice rules)`,
  pages: pages.map(({ path: p, scheme, passes, violations }) => ({ path: p, scheme, passes, violations: violations.map(({ targets, ...v }) => v) })),
}, null, 2));
