import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initStore, storeMode, newField, listFields, getField, saveField, deleteField, logEvent, exportAll } from './store.js';
import { dimensions, cards, sources, benchmarks, groundingBlock, extractCitations, KNOWLEDGE_VERSION } from './knowledge.js';
import { EXTRACT_PROMPT, TAG_PROMPT, COMPARE_PROMPT, parseJsonLoose } from './prompts.js';
import { searchOpenAlex, localCitations, parseExport, mergeStudies } from './corpus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_PDF_MB = Number(process.env.MAX_PDF_MB || 25);
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const DAILY_CAP = Number(process.env.DAILY_MODEL_CAP || 400);
const NAVIGATOR_URL = (process.env.NAVIGATOR_URL || '').replace(/\/+$/, '');

// Accept gzip-compressed JSON bodies (the client compresses field saves, which are large).
import { gunzipSync } from 'node:zlib';
app.use((req, res, next) => {
  if (req.get('content-encoding') !== 'gzip') return next();
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    try { req.body = JSON.parse(gunzipSync(Buffer.concat(chunks)).toString('utf8')); req.headers['content-encoding'] = 'identity'; req._body = true; next(); }
    catch (e) { res.status(400).json({ error: 'Bad compressed body' }); }
  });
});
app.use(express.json({ limit: `${MAX_PDF_MB * 1.5 + 2}mb` }));
app.use(express.text({ limit: '50mb', type: ['text/*', 'application/x-bibtex'] }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const hdr = (key) => ({ 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' });
let day = '', used = 0;
function overCap() { const d = new Date().toISOString().slice(0, 10); if (d !== day) { day = d; used = 0; } return used >= DAILY_CAP; }
function resolveKey(req) {
  const own = req.get('x-user-key');
  if (own) return { key: own, own: true };
  if (ACCESS_CODE && req.get('x-access-code') !== ACCESS_CODE) throw Object.assign(new Error('Access code required'), { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('No API key configured on the server. Add your own key in Settings.'), { status: 503 });
  if (overCap()) throw Object.assign(new Error('Daily model budget reached. Add your own key in Settings or try tomorrow.'), { status: 429 });
  return { key: process.env.ANTHROPIC_API_KEY, own: false };
}
function guard(req) { if (ACCESS_CODE && req.get('x-access-code') !== ACCESS_CODE) throw Object.assign(new Error('Access code required'), { status: 401 }); }

async function callModel({ key, system, content, maxTokens = 8000 }) {
  const body = { model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
  const r = await fetch(`${API_BASE}/v1/messages`, { method: 'POST', headers: hdr(key), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `Model API error ${r.status}`), { status: r.status === 401 ? 401 : 502 });
  used++;
  return { text: (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''), model: j.model, usage: j.usage, stop: j.stop_reason };
}
const pdfBlock = (b64) => {
  const bytes = Buffer.byteLength(b64, 'base64');
  if (bytes > MAX_PDF_MB * 1024 * 1024) throw Object.assign(new Error(`PDF larger than ${MAX_PDF_MB} MB`), { status: 413 });
  if (Buffer.from(b64.slice(0, 8), 'base64').toString('latin1').slice(0, 4) !== '%PDF') throw Object.assign(new Error('Not a PDF'), { status: 400 });
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 }, cache_control: { type: 'ephemeral' } };
};
const systemBlocks = (extra = '') => [{ type: 'text', text: groundingBlock(), cache_control: { type: 'ephemeral' } }, ...(extra ? [{ type: 'text', text: extra }] : [])];
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(e.status || 500).json({ error: e.message }); });

// ---- config & knowledge ----
app.get('/healthz', (_, res) => res.send('ok'));
app.get('/api/config', (_, res) => res.json({ navigatorUrl: NAVIGATOR_URL, store: storeMode, requiresAccessCode: !!ACCESS_CODE, serverKeyAvailable: !!process.env.ANTHROPIC_API_KEY, model: MODEL, maxPdfMb: MAX_PDF_MB, knowledgeVersion: KNOWLEDGE_VERSION, dimensions }));
app.get('/api/knowledge', (_, res) => res.json({ dimensions, cards, sources, benchmarks }));
app.get('/api/benchmarks', (_, res) => res.json(benchmarks));
app.post('/api/check-code', (req, res) => res.json({ ok: !ACCESS_CODE || req.body?.code === ACCESS_CODE }));

// ---- fields ----
app.get('/api/fields', wrap(async (_, res) => res.json(await listFields())));
app.post('/api/fields', wrap(async (req, res) => { guard(req); const f = newField(String(req.body.name || 'Untitled field').slice(0, 200), String(req.body.description || '').slice(0, 2000)); f.version = await saveField(f, 0); await logEvent(f.id, 'field_create', { name: f.name }); res.json(f); }));
app.get('/api/fields/:id', wrap(async (req, res) => { const f = await getField(req.params.id); if (!f) return res.status(404).json({ error: 'Not found' }); res.json(f); }));
app.put('/api/fields/:id', wrap(async (req, res) => { guard(req); const doc = req.body.doc; if (!doc || doc.id !== req.params.id) return res.status(400).json({ error: 'Bad document' }); const v = await saveField(doc, Number(req.body.version || 0)); res.json({ version: v }); }));
app.delete('/api/fields/:id', wrap(async (req, res) => { guard(req); await deleteField(req.params.id); res.json({ ok: true }); }));

// ---- corpus ----
app.post('/api/openalex/search', wrap(async (req, res) => { guard(req); const { query, fromYear, toYear, perPage, page } = req.body || {}; if (!query) return res.status(400).json({ error: 'query required' }); res.json(await searchOpenAlex({ query, fromYear, toYear, perPage, page })); }));
app.post('/api/corpus/parse', wrap(async (req, res) => { guard(req); const text = typeof req.body === 'string' ? req.body : req.body?.text; const studies = parseExport(text, req.get('x-filename') || ''); res.json({ studies }); }));
app.post('/api/corpus/local-cites', wrap(async (req, res) => res.json({ studies: localCitations(req.body.studies || []) })));
// helper used by the client to merge without duplicates (kept server-side so the rule is in one place)
app.post('/api/corpus/merge', wrap(async (req, res) => { const ex = req.body.existing || []; const added = mergeStudies(ex, req.body.incoming || []); res.json({ studies: ex, added }); }));

// ---- model steps ----
app.post('/api/extract', wrap(async (req, res) => {
  const { key } = resolveKey(req);
  const { pdfBase64, fieldId, studyId } = req.body || {};
  if (!pdfBase64) return res.status(400).json({ error: 'pdfBase64 required' });
  const out = await callModel({ key, system: systemBlocks(), content: [pdfBlock(pdfBase64), { type: 'text', text: EXTRACT_PROMPT }], maxTokens: 12000 });
  const json = parseJsonLoose(out.text);
  await logEvent(fieldId, 'extract', { studyId, claims: json.claims?.length, choices: json.choices?.length, usage: out.usage, model: out.model, stop: out.stop });
  res.json({ extraction: json, model: out.model, stop: out.stop });
}));

app.post('/api/tag', wrap(async (req, res) => {
  const { key } = resolveKey(req);
  const { pdfBase64, fieldId, studyId, claim, assumptions } = req.body || {};
  if (!pdfBase64 || !claim || !assumptions?.length) return res.status(400).json({ error: 'pdfBase64, claim and assumptions required' });
  const list = assumptions.map((a) => `- id ${a.id} [${a.dimension}]: ${a.text}`).join('\n');
  const text = `${TAG_PROMPT}\n\nCLAIM: ${claim.text}\nORIGINAL STUDY: ${claim.study || 'see claim'}\nASSUMPTIONS:\n${list}`;
  const out = await callModel({ key, system: systemBlocks(), content: [pdfBlock(pdfBase64), { type: 'text', text }], maxTokens: 6000 });
  const json = parseJsonLoose(out.text);
  await logEvent(fieldId, 'tag', { studyId, claim: claim.id, n: json.tags?.length, usage: out.usage });
  res.json({ tags: json.tags || [], citation: json.citation || null });
}));

app.post('/api/compare', wrap(async (req, res) => {
  const { key } = resolveKey(req);
  const { fieldId, reference, choices } = req.body || {};
  if (!reference?.length || !choices?.length) return res.status(400).json({ error: 'reference and choices required' });
  const R = reference.map((r) => `R ${r.key}: [${r.category}] ${r.description}`).join('\n');
  const A = choices.map((c) => `A ${c.key}: [${c.category}] ${c.description} (options: ${(c.options || []).join(' | ')})`).join('\n');
  const out = await callModel({ key, system: [{ type: 'text', text: 'You align lists of analytical choices for a methods benchmark. Be literal and conservative.' }], content: [{ type: 'text', text: `${COMPARE_PROMPT}\n\nLIST R:\n${R}\n\nLIST A:\n${A}` }], maxTokens: 6000 });
  const json = parseJsonLoose(out.text);
  await logEvent(fieldId, 'compare', { r: reference.length, a: choices.length, usage: out.usage });
  res.json(json);
}));

// Grounded explanation of a dimension or a card, for the "?" help in the UI (no PDF needed).
app.post('/api/explain', wrap(async (req, res) => {
  const { key } = resolveKey(req);
  const q = String(req.body.question || '').slice(0, 2000);
  const out = await callModel({ key, system: systemBlocks('Answer in under 150 words, plain language, and cite evidence card ids in [brackets] for every methodological claim. If the evidence base does not cover the question, say so.'), content: [{ type: 'text', text: q }], maxTokens: 600 });
  res.json({ text: out.text, citations: extractCitations(out.text) });
}));

// ---- exports ----
app.get('/api/fields/:id/export.json', wrap(async (req, res) => { const f = await getField(req.params.id); if (!f) return res.status(404).end(); res.setHeader('content-disposition', `attachment; filename="${(f.name || 'field').replace(/[^\w-]+/g, '_')}.json"`); res.json(f); }));
app.get('/api/fields/:id/coverage.csv', wrap(async (req, res) => {
  const f = await getField(req.params.id); if (!f) return res.status(404).end();
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['claim_id', 'claim', 'assumption_id', 'dimension', 'assumption', 'consequential', 'assumption_status', 'study_id', 'study', 'year', 'varied', 'how', 'result', 'quote', 'page', 'coverage_status']];
  const sById = new Map(f.studies.map((s) => [s.id, s]));
  for (const a of f.assumptions) {
    const c = f.claims.find((x) => x.id === a.claim) || {};
    const cov = f.coverage.filter((x) => x.assumption === a.id);
    if (!cov.length) rows.push([c.id, c.text, a.id, a.dimension, a.text, a.consequential, a.status, '', '', '', '', '', '', '', '', '']);
    for (const x of cov) { const s = sById.get(x.study) || {}; rows.push([c.id, c.text, a.id, a.dimension, a.text, a.consequential, a.status, x.study, s.title, s.year, x.varied, x.how, x.result, x.quote, x.page, x.status]); }
  }
  res.setHeader('content-type', 'text/csv'); res.setHeader('content-disposition', 'attachment; filename="coverage.csv"');
  res.send(rows.map((r) => r.map(esc).join(',')).join('\n'));
}));
app.get('/api/admin/export', wrap(async (req, res) => { if (!process.env.ADMIN_TOKEN || req.get('x-admin-token') !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'admin token required' }); res.json(await exportAll()); }));

app.get('*', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// Listen first so Render sees an open port; the store connects in the background (with file fallback).
app.listen(PORT, () => console.log(`coverage-map listening on ${PORT} (model ${MODEL}, knowledge ${KNOWLEDGE_VERSION})`));
initStore().catch((e) => console.error('[store] init failed', e.message));
