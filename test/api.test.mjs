// End-to-end API test against the mock model. Run: node --test test/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MOCK = 4021, PORT = 3021;
let mock, server;
const base = `http://localhost:${PORT}`;
const j = async (p, body, method, headers = {}) => { const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null), text: null }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// tiny valid-looking PDF
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');

before(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cm-'));
  mock = spawn(process.execPath, ['test/mock-model.mjs', String(MOCK)], { stdio: 'inherit' });
  server = spawn(process.execPath, ['server/index.js'], { stdio: 'inherit', env: { ...process.env, PORT: String(PORT), ANTHROPIC_BASE_URL: `http://localhost:${MOCK}`, ANTHROPIC_API_KEY: 'test', DATA_DIR: dir, ADMIN_TOKEN: 'adm', DATABASE_URL: '' } });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await wait(250); }
});
after(() => { mock.kill(); server.kill(); });

test('config and knowledge', async () => {
  const c = await j('/api/config'); assert.equal(c.status, 200); assert.equal(c.body.dimensions.length, 5);
  const k = await j('/api/knowledge'); assert.ok(k.body.cards.length > 300);
});

test('field lifecycle with optimistic versions', async () => {
  const f = (await j('/api/fields', { name: 'Test field' })).body; assert.equal(f.version, 1);
  f.notes = 'hello';
  const s1 = await j(`/api/fields/${f.id}`, { doc: f, version: 1 }, 'PUT'); assert.equal(s1.body.version, 2);
  const stale = await j(`/api/fields/${f.id}`, { doc: f, version: 1 }, 'PUT'); assert.equal(stale.status, 409);
  const g = await j(`/api/fields/${f.id}`); assert.equal(g.body.notes, 'hello'); assert.equal(g.body.version, 2);
  const l = await j('/api/fields'); assert.ok(l.body.find((x) => x.id === f.id));
});

test('corpus parsing and merge', async () => {
  const csv = 'Title,Authors,Year,DOI,Cited by,Source title\n"A study, with comma","King A.",2020,10.1/x,12,SMJ\n"Second","Roe R.",2021,,3,JOM\n';
  const r = await fetch(base + '/api/corpus/parse', { method: 'POST', headers: { 'content-type': 'text/plain', 'x-filename': 'scopus.csv' }, body: csv }); const p = await r.json();
  assert.equal(p.studies.length, 2); assert.equal(p.studies[0].doi, '10.1/x');
  const bib = '@article{k1,\n title={Third},\n author={Doe, J and Roe, R},\n year={2019},\n doi={10.2/y},\n journal={ASQ}\n}\n';
  const r2 = await fetch(base + '/api/corpus/parse', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: bib }); const p2 = await r2.json(); assert.equal(p2.studies[0].title, 'Third');
  const m = await j('/api/corpus/merge', { existing: p.studies, incoming: [...p.studies, ...p2.studies] }); assert.equal(m.body.added, 1); assert.equal(m.body.studies.length, 3);
  const wos = 'PT\tAU\tTI\tSO\tPY\tDI\tTC\nJ\tKing, A\tFourth\tSMJ\t2018\t10.3/z\t7\n';
  const r3 = await fetch(base + '/api/corpus/parse', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: wos }); const p3 = await r3.json(); assert.equal(p3.studies[0].title, 'Fourth'); assert.equal(p3.studies[0].cited_by, 7);
});

test('extract → tag → compare → exports', async () => {
  const f = (await j('/api/fields', { name: 'Flow' })).body;
  const x = await j('/api/extract', { pdfBase64: PDF, fieldId: f.id }); assert.equal(x.status, 200); assert.equal(x.body.extraction.claims.length, 1); assert.equal(x.body.extraction.choices.length, 3);
  const bad = await j('/api/extract', { pdfBase64: Buffer.from('not a pdf').toString('base64') }); assert.equal(bad.status, 400);
  const as = [{ id: 'a_1', dimension: 'theory', text: 't' }, { id: 'a_2', dimension: 'context', text: 'c' }];
  const t = await j('/api/tag', { pdfBase64: PDF, fieldId: f.id, claim: { id: 'c1', text: 'CSP → CFP' }, assumptions: as }); assert.equal(t.body.tags.length, 2); assert.equal(t.body.tags[1].varied, 'yes');
  const cmp = await j('/api/compare', { fieldId: f.id, reference: [{ key: 'r1', category: 'sample', description: 'Exclude financials' }, { key: 'r2', category: 'model', description: 'Firm FE' }], choices: [{ key: 'ch1@s', category: 'sample', description: 'Exclude financial firms', options: [] }] });
  assert.equal(cmp.body.matches.length, 2); assert.equal(cmp.body.matches[1].a.length, 0);
  // build a doc with coverage and export csv
  f.studies.push({ id: 's1', title: 'Doe 2015', authors: 'Doe', year: 2015, core: true });
  f.claims.push({ id: 'c1', study: 's1', text: 'CSP → CFP', status: 'confirmed' });
  f.assumptions.push({ id: 'a_1', claim: 'c1', dimension: 'theory', text: 'trust', consequential: 3, status: 'confirmed' });
  f.coverage.push({ id: 'v1', assumption: 'a_1', study: 's1', varied: 'yes', how: 'x', result: 'supports', quote: 'q', page: 3, status: 'confirmed' });
  await j(`/api/fields/${f.id}`, { doc: f, version: 1 }, 'PUT');
  const csv = await (await fetch(`${base}/api/fields/${f.id}/coverage.csv`)).text(); assert.ok(csv.includes('"trust"')); assert.ok(csv.split('\n').length === 2);
  const ex = await (await fetch(`${base}/api/fields/${f.id}/export.json`)).json(); assert.equal(ex.name, 'Flow');
  const adm = await j('/api/admin/export', null, 'GET', { 'x-admin-token': 'adm' }); assert.ok(adm.body.fields.length >= 2); assert.ok(adm.body.events.some((e) => e.type === 'extract'));
  const noadm = await j('/api/admin/export'); assert.equal(noadm.status, 401);
});

test('explain validates citations', async () => {
  const e = await j('/api/explain', { question: 'what is construct validity?' }); assert.equal(e.status, 200);
  assert.deepEqual(e.body.citations.map((c) => c.valid), [true, false]);
});
