// Browser walk-through against the mock model: create field → add study by hand → extract from a PDF
// → import → confirm → tag a replication → benchmark → export. Run: node test/e2e.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MOCK = 4031, PORT = 3031, base = `http://localhost:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), 'cm-e2e-'));
const pdfPath = path.join(dir, 'paper.pdf');
writeFileSync(pdfPath, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const mock = spawn(process.execPath, ['test/mock-model.mjs', String(MOCK)], { stdio: 'ignore' });
const server = spawn(process.execPath, ['server/index.js'], { stdio: 'ignore', env: { ...process.env, PORT: String(PORT), ANTHROPIC_BASE_URL: `http://localhost:${MOCK}`, ANTHROPIC_API_KEY: 't', DATA_DIR: dir, DATABASE_URL: '' } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await wait(250); }
const shots = process.argv[2] || dir;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
try {
  await page.goto(base);
  await page.fill('#newName', 'Social and financial performance');
  await page.click('#newField button');
  await page.waitForSelector('#oa');
  await page.screenshot({ path: path.join(shots, 'e2e-1-corpus.png') });
  await page.fill('#manual [name=title]', 'The corporate social performance–financial performance link'); await page.fill('#manual [name=authors]', 'Waddock & Graves'); await page.fill('#manual [name=year]', '1997');
  await page.click('#manual button'); await page.waitForSelector('tr.core');
  // export upload (Scopus CSV)
  const csv = path.join(dir, 'scopus.csv'); writeFileSync(csv, 'Title,Authors,Year,DOI,Cited by,Source title\n"Revisiting the CSP–CFP link","Zhao X., Murrell A.",2016,10.1002/smj.2579,300,SMJ\n');
  await page.setInputFiles('#expFile', csv); await page.waitForSelector('#addAll'); await page.click('#addAll'); await wait(300);
  if (!(await page.locator('table tr').count()) >= 3) throw new Error('corpus rows missing');
  // studies: extract from PDF for the manual study
  await page.click('li[data-step=studies]'); await page.waitForSelector('input[data-extract]', { state: 'attached' });
  await page.setInputFiles('input[data-extract]', pdfPath);
  await page.waitForSelector('button[data-import]', { timeout: 15000 });
  await page.screenshot({ path: path.join(shots, 'e2e-2-studies.png') });
  await page.click('button[data-import]'); await wait(300);
  // claims
  await page.click('li[data-step=claims]'); await page.waitForSelector('[data-confirm-all]');
  await page.screenshot({ path: path.join(shots, 'e2e-3-claims.png') });
  await page.click('[data-confirm-all]'); await wait(200);
  const nConf = await page.locator('.status.confirmed').count(); if (nConf < 6) throw new Error('confirm all failed ' + nConf);
  // coverage: tag a new PDF against the claim
  await page.click('li[data-step=coverage]'); await page.waitForSelector('#tagForm');
  await page.setInputFiles('#tagForm input[name=pdf]', pdfPath); await page.click('#tagForm button:not([type=button])');
  await page.waitForSelector('button[data-vc]', { timeout: 15000 });
  await page.screenshot({ path: path.join(shots, 'e2e-4-coverage.png'), fullPage: true });
  const vc = page.locator('button[data-vc]'); const n = await vc.count(); for (let i = 0; i < n; i++) await page.locator('button[data-vc]').first().click();
  if (!(await page.locator('.cell.covered').count())) throw new Error('no covered cells after confirming');
  // choices benchmark
  await page.click('li[data-step=choices]'); await page.waitForSelector('#loadBench');
  await page.click('#loadBench'); await wait(200); await page.click('#saveRef'); await wait(200);
  await page.click('#runCompare'); await page.waitForSelector('text=reference choices found', { timeout: 15000 });
  await page.screenshot({ path: path.join(shots, 'e2e-5-choices.png'), fullPage: true });
  // export
  await page.click('li[data-step=export]'); await page.waitForSelector('#notes');
  await page.screenshot({ path: path.join(shots, 'e2e-6-export.png'), fullPage: true });
  await wait(1200); // debounced save
  const saved = await (await fetch(`${base}/api/fields`)).json(); if (saved[0].claims !== 1) throw new Error('field not saved');
  // mobile check
  await page.setViewportSize({ width: 390, height: 800 }); await page.click('li[data-step=coverage]'); await wait(300);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth); if (sw > 400) throw new Error('horizontal overflow on mobile: ' + sw);
  await page.screenshot({ path: path.join(shots, 'e2e-7-mobile.png') });
  if (errors.length) throw new Error('console errors: ' + errors.join(' | '));
  console.log('E2E OK, screenshots in', shots);
} catch (e) { console.error('E2E FAILED:', e.message); process.exitCode = 1; await page.screenshot({ path: path.join(shots, 'e2e-fail.png'), fullPage: true }); }
finally { await browser.close(); mock.kill(); server.kill(); }
