// Opens the built /roaree page in headless Chromium, wakes Roaree, sends one message and prints
// the reply, with the page's console and errors. No GPU on CI runners, so this exercises the
// page's CPU (WASM) fallback: the same files, tokenizer, patch and generation loop as WebGPU.
// Usage: node steer/browser-test.mjs [base url]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4321';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => console.log(`[page ${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
await page.goto(`${base}/roaree`);
const t0 = Date.now();
await page.click('#rr-load');
await page.waitForSelector('#rr-chat:not([hidden]), #rr-load:not([disabled])', { timeout: 20 * 60e3 });
console.log(`status after load (${((Date.now() - t0) / 1000).toFixed(0)}s): "${await page.textContent('#rr-status')}"`);
if (await page.isHidden('#rr-chat')) {
  console.log('FAILED: the chat never appeared');
  process.exit(1);
}
for (const msg of ['Tell me about yourself.', "What's 2+2?"]) {
  const t1 = Date.now();
  await page.fill('#rr-input', msg);
  await page.click('#rr-send');
  await page.waitForSelector('#rr-send:not([hidden])', { timeout: 20 * 60e3 });
  const replies = await page.$$eval('.rr-assistant', (els) => els.map((e) => e.textContent));
  console.log(`reply to "${msg}" (${((Date.now() - t1) / 1000).toFixed(0)}s): ${replies.at(-1)}`);
}
await browser.close();
