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
  await page.waitForSelector('#iqStatement');
  await page.fill('#iqStatement', 'Does social performance pay, and does it depend on how it is measured?'); await page.fill('#iqTerms', '"social performance" AND "financial performance"'); await page.fill('#iqSeeds', 'Waddock & Graves (1997) SMJ 10.1002/(SICI)1097-0266(199704)18:4<303::AID-SMJ869>3.0.CO;2-G');
  await page.click('#iqAddSeeds'); await wait(300); await page.click('#iqToSearch'); await page.waitForSelector('#oa');
  if (!(await page.inputValue('#oa [name=q]')).includes('social performance')) throw new Error('search not prefilled from inquiry');
  await page.screenshot({ path: path.join(shots, 'e2e-0-inquiry.png') });
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
  // predictions: confirm all, tick core
  await page.click('li[data-step=predictions]'); await page.waitForSelector('#confirmAllP');
  await page.screenshot({ path: path.join(shots, 'e2e-3-predictions.png') });
  await page.click('#confirmAllP'); await wait(200);
  if ((await page.locator('.status.confirmed').count()) < 2) throw new Error('confirm all failed');
  if (!(await page.locator('input[data-core-p]:checked').count())) throw new Error('core prediction not ticked from extraction');
  // coach on predictions step
  await page.click('#starters button'); await page.waitForSelector('#chat .cite', { timeout: 15000 }); await page.waitForSelector('#chat .msg.bot .meta', { timeout: 15000 });
  if (!(await page.locator('#chat .cite.bad').count())) throw new Error('invalid citation not marked');
  await page.click('#chat .cite:not(.bad)'); await page.waitForSelector('#modal .card-view'); await page.click('#modal [data-close]');
  await page.screenshot({ path: path.join(shots, 'e2e-3b-coach.png') });
  // second study: same PDF again as a new study → consolidation merges p1, adds p2 as new (mock maps first only)
  await page.click('li[data-step=studies]'); await page.waitForSelector('#fileNew', { state: 'attached' }); await page.setInputFiles('#fileNew', pdfPath);
  await page.waitForFunction(() => document.querySelectorAll('button[data-import]').length >= 1, null, { timeout: 15000 }); await page.click('button[data-import]'); await wait(500);
  // designs
  await page.click('li[data-step=designs]'); await page.waitForSelector('.card table');
  const rows = await page.locator('.card .cell').count(); if (rows < 9) throw new Error('design map rows missing: ' + rows);
  await page.screenshot({ path: path.join(shots, 'e2e-4-designs.png'), fullPage: true });
  for (const d of await page.locator('.panel details').all()) { if (!(await d.getAttribute('open'))) await d.locator('summary').click(); }
  const n = await page.locator('button[data-act=confirm][data-kind=test]').count(); for (let i = 0; i < n; i++) await page.locator('button[data-act=confirm][data-kind=test]').first().click();
  const nPred = (await (await fetch(`${base}/api/fields`)).json()); if (nPred[0].predictions !== 3) { const fx = await (await fetch(`${base}/api/fields/${nPred[0].id}`)).json(); throw new Error('expected 3 predictions after consolidation, got ' + nPred[0].predictions + ' :: ' + fx.predictions.map((x) => x.text.slice(0, 30) + '@' + x.study).join(' | ') + ' studies=' + fx.studies.map((x) => x.id + ':' + !!x.extraction + ':' + !!x.imported).join(',')); }
  // assumptions & decision
  await page.click('li[data-step=assumptions]'); await page.waitForSelector('[data-unearth]'); await page.click('[data-unearth]'); await page.waitForSelector('select[data-judge]', { timeout: 15000 });
  await page.selectOption('select[data-judge]', 'violated'); await page.click('input[value=replication]'); await wait(300); await page.waitForSelector('.decision a.plan-link, .decision', { timeout: 5000 });
  await page.fill('input[data-dreason]', 'All designs are correlational on the same database.'); await wait(500);
  if (!(await page.locator('#chat').count())) throw new Error('coach missing');
  await page.screenshot({ path: path.join(shots, 'e2e-5-assumptions.png'), fullPage: true });
  // loop back with a note
  page.once('dialog', (d) => d.accept('Weigh Hillman & Keim more')); await page.click('[data-loop=corpus]'); await page.waitForSelector('#oa');
  // choices benchmark
  await page.click('li[data-step=choices]'); await page.waitForSelector('#loadBench');
  await page.click('#loadBench'); await wait(200); await page.click('#saveRef'); await wait(200);
  await page.click('#runCompare'); await page.waitForSelector('text=reference choices found', { timeout: 15000 });
  await page.screenshot({ path: path.join(shots, 'e2e-5-choices.png'), fullPage: true });
  // export
  await page.click('li[data-step=export]'); await page.waitForSelector('#notes');
  await page.screenshot({ path: path.join(shots, 'e2e-6-export.png'), fullPage: true });
  await wait(1200); // debounced save
  const saved = await (await fetch(`${base}/api/fields`)).json(); if (!(saved[0].predictions >= 2)) throw new Error('field not saved: ' + JSON.stringify(saved[0]));
  const full = await (await fetch(`${base}/api/fields/${saved[0].id}`)).json(); if (!full.loops.length || !Object.keys(full.decisions).length || !full.inquiry.statement) throw new Error('v0.3 state missing: ' + JSON.stringify({ loops: full.loops.length, decisions: full.decisions, inquiry: full.inquiry.statement }));
  // mobile check
  await page.setViewportSize({ width: 390, height: 800 }); await page.click('li[data-step=designs]'); await wait(300);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth); if (sw > 400) { const who = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > 400 && el.getBoundingClientRect().width > 0).slice(0, 8).map((el) => el.tagName + '#' + el.id + '.' + el.className + ' ' + Math.round(el.getBoundingClientRect().right)).join(' | ')); throw new Error('horizontal overflow on mobile: ' + sw + ' :: ' + who); }
  await page.screenshot({ path: path.join(shots, 'e2e-7-mobile.png') });
  // delete from the home list, with the typed confirmation
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(base + '/#home'); await page.waitForSelector('[data-delete]');
  page.once('dialog', (d) => d.accept('DELETE')); await page.click('[data-delete]'); await wait(500);
  const left = await (await fetch(`${base}/api/fields`)).json(); if (left.length !== 0) throw new Error('field not deleted: ' + left.length);
  if (errors.length) throw new Error('console errors: ' + errors.join(' | '));
  console.log('E2E OK, screenshots in', shots);
} catch (e) { console.error('E2E FAILED:', e.message); process.exitCode = 1; await page.screenshot({ path: path.join(shots, 'e2e-fail.png'), fullPage: true }); }
finally { await browser.close(); mock.kill(); server.kill(); }
