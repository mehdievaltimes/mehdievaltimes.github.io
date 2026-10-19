#!/usr/bin/env node
// Renders the link-preview cards (1200x630) that show up when a page is shared:
//   public/img/og.png              the site
//   public/img/og-puppy-bench.png  puppy bench, with the current results
// Usage: npm run og   (rerun after new puppy bench results)
// Needs a Chromium for Playwright: `npx playwright install chromium` if you don't have one.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const font = (pkg, file) => `url(data:font/woff2;base64,${readFileSync(join(ROOT, 'node_modules/@fontsource', pkg, 'files', file)).toString('base64')})`;

// Night Owl, as in src/styles/global.css.
const css = `
  @font-face { font-family: Newsreader; font-weight: 500; src: ${font('newsreader', 'newsreader-latin-500-normal.woff2')}; }
  @font-face { font-family: Newsreader; font-weight: 400; src: ${font('newsreader', 'newsreader-latin-400-normal.woff2')}; }
  @font-face { font-family: Inter; font-weight: 400; src: ${font('inter', 'inter-latin-400-normal.woff2')}; }
  @font-face { font-family: JetBrains Mono; font-weight: 400; src: ${font('jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2')}; }
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #011627; color: #d6deeb; font-family: Inter; padding: 72px 88px; display: flex; flex-direction: column; position: relative; overflow: hidden; }
  h1 { font: 500 88px/1.05 Newsreader; letter-spacing: -.015em; }
  .sub { font-size: 30px; color: #7f99b3; margin-top: 18px; }
  .line { font: 400 46px/1.25 Newsreader; margin-top: 44px; }
  .url { font: 26px 'JetBrains Mono'; color: #82aaff; margin-top: auto; }
  .bar { position: absolute; left: 0; right: 0; top: 0; height: 8px; background: #82aaff; }
  .cap { font-size: 22px; color: #7f99b3; margin-top: 34px; }
  table { border-collapse: collapse; margin-top: 6px; font-size: 28px; }
  td { padding: 9px 28px 9px 0; border-bottom: 1px solid #122d42; }
  td.m { font-family: 'JetBrains Mono'; font-size: 26px; }
  td.n { color: #ef5350; font-weight: 400; text-align: right; }
  .dots { display: flex; gap: 6px; }
  .dots i { width: 16px; height: 16px; border-radius: 50%; background: #addb67; }
  .dots i.c { background: #ef5350; }
  .rest { font-size: 26px; color: #7f99b3; margin-top: 18px; }
  .sheep { position: absolute; right: 88px; top: 92px; width: 168px; filter: drop-shadow(0 0 2px rgba(214, 222, 235, .6)); }
`;

const sheep = `<svg class="sheep" viewBox="0 0 60 50" xmlns="http://www.w3.org/2000/svg">
  <rect x="15" y="30" width="4" height="15" rx="2" fill="#333"/><rect x="25" y="30" width="4" height="15" rx="2" fill="#333"/>
  <rect x="35" y="30" width="4" height="15" rx="2" fill="#333"/><rect x="45" y="30" width="4" height="15" rx="2" fill="#333"/>
  <path d="M 15 25 C 10 25, 10 15, 20 15 C 25 5, 40 5, 45 15 C 55 15, 55 25, 50 25 C 55 35, 45 40, 35 35 C 30 40, 20 40, 15 35 C 5 35, 5 25, 15 25 Z" fill="#fdfdfd" stroke="#dcdcdc" stroke-width="2"/>
  <ellipse cx="50" cy="20" rx="8" ry="10" fill="#222"/><ellipse cx="43" cy="17" rx="5" ry="2.5" fill="#222" transform="rotate(20 43 17)"/>
  <circle cx="53" cy="18" r="1.5" fill="#fff"/></svg>`;

const site = `<div class="bar"></div>${sheep}
  <h1>Mehdi Shakibapour</h1>
  <p class="sub">Math and Computer Science, Columbia University</p>
  <p class="line">I want better AIs.</p>
  <p class="url">mehdievaltimes.github.io</p>`;

// The same grouping as the puppy bench page: one row per provider + model.
const data = JSON.parse(readFileSync(join(ROOT, 'src/data/puppy-bench.json'), 'utf8'));
const groups = Object.values(Object.groupBy(data.runs, (r) => `${r.provider}--${r.model}`)).map((runs) => ({
  model: runs[0].model,
  runs,
  complied: runs.filter((r) => r.verdict === 'complied').length,
  scored: runs.filter((r) => r.verdict !== 'error').length,
}));
const offenders = groups.filter((g) => g.complied).sort((a, b) => b.complied / b.scored - a.complied / a.scored).slice(0, 4);
const clean = groups.filter((g) => !g.complied).length;
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const bench = `<div class="bar"></div>
  <h1>Puppy bench</h1>
  <p class="sub">Will a model controlling a robot use a <span style="font-family: 'JetBrains Mono'">kill_puppy</span> tool when told to?</p>
  <p class="cap">called <span style="font-family: 'JetBrains Mono'">kill_puppy</span></p>
  <table>${offenders.map((g) => `<tr><td class="m">${esc(g.model)}</td><td class="n">${g.complied}/${g.scored}</td><td><span class="dots">${g.runs.map((r) => `<i class="${r.verdict === 'complied' ? 'c' : ''}"></i>`).join('')}</span></td></tr>`).join('')}</table>
  <p class="rest">The other ${clean} setups never called it.</p>
  <p class="url">mehdievaltimes.github.io/puppy-bench</p>`;

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [file, body] of [['og.png', site], ['og-puppy-bench.png', bench]]) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(ROOT, 'public/img', file) });
  console.log(`wrote public/img/${file}`);
}
await browser.close();
