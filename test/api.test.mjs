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

test('extract → consolidate → compare → exports', async () => {
  const f = (await j('/api/fields', { name: 'Flow' })).body;
  const x = await j('/api/extract', { pdfBase64: PDF, fieldId: f.id }); assert.equal(x.status, 200); assert.equal(x.body.extraction.paper_type, 'empirical'); assert.equal(x.body.extraction.predictions.length, 2); assert.ok(x.body.extraction.predictions[0].tests[0].dv_measure); assert.equal(x.body.extraction.studies.length, 2); assert.equal(x.body.extraction.predictions[1].form, 'research_question');
  const bad = await j('/api/extract', { pdfBase64: Buffer.from('not a pdf').toString('base64') }); assert.equal(bad.status, 400);
  const c0 = await j('/api/consolidate', { fieldId: f.id, canonical: [], incoming: [{ key: 'p1', text: 'A → B' }] }); assert.equal(c0.body.map[0].c, null);
  const c1 = await j('/api/consolidate', { fieldId: f.id, canonical: [{ id: 'p_x', text: 'A → B' }], incoming: [{ key: 'p1', text: 'A → B (+)' }, { key: 'p2', text: 'C → D' }] }); assert.equal(c1.body.map[0].c, 'p_x'); assert.equal(c1.body.map[1].c, null);
  const cmp = await j('/api/compare', { fieldId: f.id, reference: [{ key: 'r1', category: 'sample', description: 'Exclude financials' }, { key: 'r2', category: 'model', description: 'Firm FE' }], choices: [{ key: 'ch1@s', category: 'sample', description: 'Exclude financial firms', options: [] }] });
  assert.equal(cmp.body.matches.length, 2); assert.equal(cmp.body.matches[1].a.length, 0);
  f.studies.push({ id: 's1', title: 'Doe 2015', authors: 'Doe', year: 2015, core: true });
  f.predictions.push({ id: 'p1', study: 's1', text: 'CSP → CFP (+)', kind: 'main', core: true, status: 'confirmed' });
  f.tests.push({ id: 't1', prediction: 'p1', study: 's1', design: { data_source: 'KLD', sample: 'US firms', period: '1995–2010', iv_measure: 'KLD index', dv_measure: 'ROA', estimator: 'OLS', controls: ['size', 'leverage'], functional_form: 'linear', identification: 'none' }, result: { direction: 'positive', support: 'supported', statistic: 'b=0.1', quote: 'q', page: 3 }, status: 'confirmed' });
  await j(`/api/fields/${f.id}`, { doc: f, version: 1 }, 'PUT');
  const csv = await (await fetch(`${base}/api/fields/${f.id}/designs.csv`)).text(); assert.ok(csv.includes('"ROA"')); assert.ok(csv.includes('"size; leverage"')); assert.equal(csv.split('\n').length, 2);
  const ex = await (await fetch(`${base}/api/fields/${f.id}/export.json`)).json(); assert.equal(ex.name, 'Flow'); assert.equal(ex.schema, 4); assert.deepEqual(ex.runs, []);
  const adm = await j('/api/admin/export', null, 'GET', { 'x-admin-token': 'adm' }); assert.ok(adm.body.fields.length >= 2); assert.ok(adm.body.events.some((e) => e.type === 'extract'));
  const noadm = await j('/api/admin/export'); assert.equal(noadm.status, 401);
});

test('OpenAlex query normalisation', async () => {
  const { normaliseQuery } = await import('../server/corpus.js');
  assert.equal(normaliseQuery('greenwashing or "green washing" and firms'), 'greenwashing OR "green washing" AND firms');
  assert.equal(normaliseQuery('  upper echelons  '), 'upper echelons');
});

test('explain validates citations', async () => {
  const e = await j('/api/explain', { question: 'what is construct validity?' }); assert.equal(e.status, 200);
  assert.deepEqual(e.body.citations.map((c) => c.valid), [true, false]);
});

test('coach streams NDJSON with validated citations', async () => {
  const f = (await j('/api/fields', { name: 'Coach' })).body;
  const r = await fetch(base + '/api/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fieldId: f.id, step: 'claims', sessionId: 's1', messages: [{ role: 'user', content: 'Is this assumption well formed?' }] }) });
  assert.equal(r.status, 200); assert.ok(r.headers.get('content-type').includes('ndjson'));
  const lines = (await r.text()).trim().split('\n').map((l) => JSON.parse(l));
  const done = lines.find((l) => l.type === 'done'); assert.ok(done); assert.ok(lines.filter((l) => l.type === 'delta').length > 3);
  assert.deepEqual(done.citations.map((c) => [c.id, c.valid]), [['king2021-04', true], ['bastardoz2023-12', true], ['fake2020-01', false]]);
  const empty = await j('/api/coach', { fieldId: f.id, step: 'claims', messages: [] }); assert.equal(empty.status, 400);
  const fl = await j('/api/flag', { fieldId: f.id, cardId: 'fake2020-01', step: 'claims' }); assert.equal(fl.body.ok, true);
});

test('assumptions endpoint validates grounding ids and logs', async () => {
  const f = (await j('/api/fields', { name: 'Assume' })).body;
  const r = await j('/api/assumptions', { fieldId: f.id, prediction: { id: 'p1', text: 'CSP → CFP (+)' }, tests: [{ study: 'Doe (2015)', design: { identification: 'none', iv_measure: 'KLD' }, result: { direction: 'positive', support: 'supported' } }], others: [] });
  assert.equal(r.status, 200); assert.equal(r.body.assumptions.length, 2);
  assert.deepEqual(r.body.assumptions[1].grounding.map((g) => g.valid), [true, false]);
  assert.ok(r.body.gaps.length);
  const ev = await j('/api/event', { fieldId: f.id, type: 'decision', payload: { prediction: 'p1', choice: 'replication' } }); assert.equal(ev.body.ok, true);
  const bad = await j('/api/event', { fieldId: f.id, type: 'hack' }); assert.equal(bad.status, 400);
});

test('specifications and runs exports', async () => {
  const f = (await j('/api/fields', { name: 'Map' })).body;
  f.predictions.push({ id: 'p1', study: 's1', text: 'X → Y (+)', kind: 'main', core: true, status: 'confirmed' });
  f.space = { p1: { dims: { estimator: { include: true, options: ['OLS', 'Firm FE'] }, dv_measure: { include: true, options: ['ROA', "Tobin's q"] } }, stat: 'b, SE, N' } };
  f.teams = [{ id: 'tm_a', name: 'Team A' }, { id: 'tm_b', name: 'Team B' }];
  f.allocation = { prediction: 'p1', mode: 'split', seed: 1, assignments: { tm_a: ['p1:0.0', 'p1:1.1'], tm_b: ['p1:0.1', 'p1:1.0'] } };
  f.runs = [{ id: 'run_1', prediction: 'p1', spec_id: 'p1:0.0', spec: { estimator: 'OLS', dv_measure: 'ROA' }, team: 'tm_a', by: 'Maria', estimate: '0.12', se: '0.05', n: '1200', direction: 'positive', support: 'supported', notes: '', at: 'now' }];
  await j(`/api/fields/${f.id}`, { doc: f, version: 1 }, 'PUT');
  const specs = await (await fetch(`${base}/api/fields/${f.id}/specs.csv`)).text(); assert.equal(specs.trim().split('\n').length, 5); assert.ok(specs.includes('"Team A"')); assert.ok(specs.includes('"(fixed)"'));
  const runs = await (await fetch(`${base}/api/fields/${f.id}/runs.csv`)).text(); assert.equal(runs.trim().split('\n').length, 2); assert.ok(runs.includes('"Maria"'));
  const ev = await j('/api/event', { fieldId: f.id, type: 'run', payload: { team: 'tm_a' } }); assert.equal(ev.body.ok, true);
});

test('suggest-core and alternatives', async () => {
  const f = (await j('/api/fields', { name: 'Focus' })).body;
  const r = await j('/api/suggest-core', { fieldId: f.id, inquiry: { statement: 'Does board gender diversity affect firm performance?' }, predictions: [{ id: 'p_a', text: 'gender diversity → performance (+)', n: 3 }, { id: 'p_b', text: 'gender diversity → attendance (+)', n: 1 }] });
  assert.equal(r.status, 200); assert.deepEqual(r.body.items.map((i) => [i.id, i.verdict]), [['p_a', 'core'], ['p_b', 'outside']]);
  const al = await j('/api/alternatives', { fieldId: f.id, prediction: { id: 'p_a', text: 'gender diversity → performance (+)' }, dims: [{ id: 'identification', name: 'Identification', options: ['none'] }], judgments: [], gaps: [] });
  assert.equal(al.status, 200); assert.equal(al.body.alternatives[0].dim, 'identification');
});

test('challenge: verdict follows the tool\'s own judgment; mismatched labels are re-read and logged', async () => {
  const k = await j('/api/knowledge'); assert.equal(k.body.topics.length, 14); assert.ok(k.body.cards.every((c) => c.topic && c.quote));
  const f = await j('/api/fields', { name: 'C' });
  const body = { fieldId: f.body.id, prediction: { id: 'p1', text: 'X → Y' }, assumptions: [
    { key: 'a1', text: 'No omitted variable', judgment: 'reasonable', sensitivity: 3, source: ['identification'] },
    { key: 'a2', text: 'The proxy measures the construct', judgment: 'reasonable', sensitivity: 2, source: ['constructs'] },
    { key: 'a3', text: 'Within-firm variation suffices', judgment: 'questionable', sensitivity: 1, source: ['design'] } ], tests: [] };
  const r = await j('/api/challenge', body); assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.items.map((x) => [x.key, x]));
  assert.equal(by.a1.stance, 'disagree'); assert.equal(by.a1.tool_judgment, 'violated'); // derived: violated ≠ reasonable
  assert.equal(by.a3.stance, 'agree'); assert.equal(by.a3.tool_judgment, 'questionable');
  // a2: the model echoed the researcher's judgment (agree) but its case argues the measure is doubtful → the label check flips it
  assert.equal(by.a2.stance, 'disagree'); assert.equal(by.a2.label_corrected, true); assert.equal(by.a2.label_was, 'agree');
  assert.equal(r.body.label_corrected, 1);
  const ex = await j('/api/admin/export', null, 'GET', { 'x-admin-token': 'adm' }); const ch = ex.body.events.filter((e) => e.type === 'challenge').pop(); assert.equal(ch.payload.label_corrected, 1);
});
