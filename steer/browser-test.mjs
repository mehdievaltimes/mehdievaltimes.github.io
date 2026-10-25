// Opens the built /sae page in headless Chromium, loads the model, sends a message with two different
// features and prints the replies, with the page's console and errors. No GPU on CI runners, so this exercises the
// page's CPU (WASM) fallback: the same files, tokenizer, patch and generation loop as WebGPU.
// Usage: node steer/browser-test.mjs [base url]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4321';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => console.log(`[page ${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
await page.goto(`${base}/sae`);
const t0 = Date.now();
await page.click('#sae-load');
await page.waitForSelector('#sae-chat:not([hidden]), #sae-load:not([disabled])', { timeout: 20 * 60e3 });
console.log(`status after load (${((Date.now() - t0) / 1000).toFixed(0)}s): "${await page.textContent('#sae-status')}"`);
if (await page.isHidden('#sae-chat')) {
  console.log('FAILED: the chat never appeared');
  process.exit(1);
}
for (const [n, msg] of [[0, 'Tell me about yourself.'], [1, "What's 2+2?"]]) {
  const t1 = Date.now();
  await page.locator('label.sae-feature').nth(n).click();
  await page.fill('#sae-input', msg);
  await page.click('#sae-send');
  await page.waitForSelector('#sae-send:not([hidden])', { timeout: 20 * 60e3 });
  const replies = await page.$$eval('.sae-assistant', (els) => els.map((e) => e.textContent));
  console.log(`reply to "${msg}" (${((Date.now() - t1) / 1000).toFixed(0)}s): ${replies.at(-1)}`);
}
await browser.close();
