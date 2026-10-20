import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initStore, storeMode, newField, listFields, getField, saveField, deleteField, logEvent, exportAll } from './store.js';
import { dimensions, designDimensions, cards, sources, benchmarks, cardById, groundingBlock, extractCitations, coachSystemBlocks, KNOWLEDGE_VERSION } from './knowledge.js';
import { EXTRACT_PROMPT, CONSOLIDATE_PROMPT, COMPARE_PROMPT, ASSUMPTIONS_PROMPT, parseJsonLoose } from './prompts.js';
import { searchOpenAlex, localCitations, parseExport, mergeStudies } from './corpus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_PDF_MB = Number(process.env.MAX_PDF_MB || 25);
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const DAILY_CAP = Number(process.env.DAILY_MODEL_CAP || 400);
const COACH_MAX_TOKENS = Number(process.env.COACH_MAX_TOKENS || 1200);
const coachHits = new Map(); // sessionId -> timestamps (per-hour limit on the server key)
function coachLimited(sid) { const now = Date.now(); const arr = (coachHits.get(sid) || []).filter((t) => now - t < 3600e3); arr.push(now); coachHits.set(sid, arr); return arr.length > Number(process.env.COACH_PER_HOUR || 60); }
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
app.get('/api/config', (_, res) => res.json({ navigatorUrl: NAVIGATOR_URL, store: storeMode, requiresAccessCode: !!ACCESS_CODE, serverKeyAvailable: !!process.env.ANTHROPIC_API_KEY, model: MODEL, maxPdfMb: MAX_PDF_MB, knowledgeVersion: KNOWLEDGE_VERSION, dimensions, designDimensions }));
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
app.post('/api/openalex/search', wrap(async (req, res) => { guard(req); const { query, fromYear, toYear, perPage, page, sort } = req.body || {}; if (!query) return res.status(400).json({ error: 'query required' }); const allowed = { cites: 'cited_by_count:desc', recent: 'publication_date:desc', relevance: 'relevance_score:desc' }; res.json(await searchOpenAlex({ query, fromYear, toYear, perPage, page, sort: allowed[sort] || allowed.cites })); }));
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
  await logEvent(fieldId, 'extract', { studyId, type: json.paper_type, predictions: json.predictions?.length, choices: json.choices?.length, usage: out.usage, model: out.model, stop: out.stop });
  res.json({ extraction: json, model: out.model, stop: out.stop });
}));

app.post('/api/consolidate', wrap(async (req, res) => {
  const { key } = resolveKey(req);
  const { fieldId, canonical, incoming } = req.body || {};
  if (!incoming?.length) return res.json({ map: [] });
  if (!canonical?.length) return res.json({ map: incoming.map((n) => ({ n: n.key, c: null, confidence: 'high', note: 'first in map' })) });
  const C = canonical.map((c) => `C ${c.id}: ${c.text}${c.kind ? ` [${c.kind}]` : ''}`).join('\n');
  const N = incoming.map((n) => `N ${n.key}: ${n.text}${n.kind ? ` [${n.kind}]` : ''}`).join('\n');
  const out = await callModel({ key, system: [{ type: 'text', text: 'You consolidate predictions across studies for a field map. Be literal and conservative: merge only when constructs and direction match.' }], content: [{ type: 'text', text: `${CONSOLIDATE_PROMPT}\n\nLIST C:\n${C}\n\nLIST N:\n${N}` }], maxTokens: 3000 });
  const json = parseJsonLoose(out.text);
  await logEvent(fieldId, 'consolidate', { c: canonical.length, n: incoming.length, merged: (json.map || []).filter((m) => m.c).length, usage: out.usage });
  res.json({ map: json.map || [] });
}));

app.post('/api/assumptions', wrap(async (req, res) => {
  const { key } = resolveKey(req);
  const { fieldId, prediction, tests, others } = req.body || {};
  if (!prediction?.text) return res.status(400).json({ error: 'prediction required' });
  const T = (tests || []).map((t, i) => `TEST ${i + 1} (${t.study || 'study'}${t.study_label ? ', ' + t.study_label : ''}): ${Object.entries(t.design || {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(', ') : v ?? 'n/a'}`).join('; ')} → result: ${t.result?.direction || '?'}/${t.result?.support || '?'}`).join('\n') || '(no empirical tests recorded yet)';
  const O = (others || []).map((o) => `- ${o.id}: ${o.text}`).join('\n') || '(none)';
  const content = `${ASSUMPTIONS_PROMPT}\n\nPREDICTION: ${prediction.text}${prediction.statement ? ' — ' + prediction.statement : ''}\n\n<tests>\n${T}\n</tests>\n\n<other_predictions>\n${O}\n</other_predictions>`;
  const out = await callModel({ key, system: systemBlocks(), content: [{ type: 'text', text: content }], maxTokens: 4000 });
  const json = parseJsonLoose(out.text);
  const seen = extractCitations(JSON.stringify(json.assumptions || []));
  await logEvent(fieldId, 'assumptions', { prediction: prediction.id, n: json.assumptions?.length, invalid: seen.filter((c) => !c.valid).map((c) => c.id), usage: out.usage });
  for (const a of json.assumptions || []) a.grounding = (a.grounding || []).map((id) => ({ id: String(id).replace(/[\[\]]/g, ''), valid: cardById.has(String(id).replace(/[\[\]]/g, '')) }));
  res.json({ assumptions: json.assumptions || [], gaps: json.gaps || [], overlaps: json.overlaps || [] });
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

// ---- coach (streams NDJSON: {type:'delta',text} ... {type:'done',citations,stop,model}) ----
app.post('/api/coach', wrap(async (req, res) => {
  const { key, own } = resolveKey(req);
  const { fieldId, step, messages, sessionId } = req.body || {};
  if (!own && coachLimited(sessionId || req.ip)) return res.status(429).json({ error: 'Coach limit reached for this hour. Add your own key in Settings or try later.' });
  const convo = (Array.isArray(messages) ? messages : []).slice(-12).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 6000) }));
  const merged = []; for (const m of convo) { const last = merged[merged.length - 1]; if (last && last.role === m.role) last.content += '\n\n' + m.content; else merged.push({ ...m }); }
  if (!merged.length || merged[merged.length - 1].role !== 'user') return res.status(400).json({ error: 'Nothing to answer.' });
  const field = fieldId ? await getField(fieldId) : null;
  const upstream = await fetch(`${API_BASE}/v1/messages`, { method: 'POST', headers: hdr(key), body: JSON.stringify({ model: MODEL, max_tokens: COACH_MAX_TOKENS, temperature: 0.3, stream: true, system: coachSystemBlocks(field, step), messages: merged }) });
  if (!upstream.ok) { const j = await upstream.json().catch(() => ({})); return res.status(upstream.status === 401 ? 401 : 502).json({ error: j.error?.message || `Model API error ${upstream.status}` }); }
  used++;
  res.setHeader('content-type', 'application/x-ndjson'); res.setHeader('cache-control', 'no-cache'); res.flushHeaders?.();
  const send = (o) => res.write(JSON.stringify(o) + '\n');
  let text = '', stop = null, model = null, buf = ''; const dec = new TextDecoder();
  try {
    for await (const chunk of upstream.body) {
      buf += dec.decode(chunk, { stream: true }); const parts = buf.split('\n\n'); buf = parts.pop();
      for (const part of parts) { const line = part.split('\n').find((l) => l.startsWith('data:')); if (!line) continue; let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (ev.type === 'message_start') model = ev.message?.model || model;
        else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { text += ev.delta.text; send({ type: 'delta', text: ev.delta.text }); }
        else if (ev.type === 'message_delta') stop = ev.delta?.stop_reason || stop; }
    }
  } catch (e) { send({ type: 'error', error: 'The connection to the AI service was interrupted.' }); }
  const citations = extractCitations(text);
  await logEvent(fieldId, 'coach', { step, invalid: citations.filter((c) => !c.valid).map((c) => c.id), n: citations.length, stop, chars: text.length });
  send({ type: 'done', citations, stop, model }); res.end();
}));
app.post('/api/event', wrap(async (req, res) => { const { fieldId, type, payload } = req.body || {}; const ok = ['coach_open', 'coach_close', 'nudge_shown', 'nudge_dismissed', 'loop_back', 'decision', 'judgment']; if (!ok.includes(type)) return res.status(400).json({ error: 'unknown event' }); await logEvent(fieldId, type, payload || {}); res.json({ ok: true }); }));
app.post('/api/flag', wrap(async (req, res) => { const { fieldId, cardId, step, note } = req.body || {}; await logEvent(fieldId, 'citation_flag', { cardId: String(cardId || '').slice(0, 40), step, note: String(note || '').slice(0, 500) }); res.json({ ok: true }); }));

// ---- exports ----
app.get('/api/fields/:id/export.json', wrap(async (req, res) => { const f = await getField(req.params.id); if (!f) return res.status(404).end(); res.setHeader('content-disposition', `attachment; filename="${(f.name || 'field').replace(/[^\w-]+/g, '_')}.json"`); res.json(f); }));
app.get('/api/fields/:id/designs.csv', wrap(async (req, res) => {
  const f = await getField(req.params.id); if (!f) return res.status(404).end();
  const esc = (v) => `"${String(Array.isArray(v) ? v.join('; ') : v ?? '').replace(/"/g, '""')}"`;
  const dd = designDimensions.map((d) => d.id);
  const rows = [['prediction_id', 'prediction', 'kind', 'core', 'prediction_status', 'study_id', 'study', 'year', 'label', ...dd, 'result_direction', 'support', 'statistic', 'quote', 'page', 'test_status']];
  const sById = new Map((f.studies || []).map((s) => [s.id, s]));
  for (const p of f.predictions || []) {
    const ts = (f.tests || []).filter((t) => t.prediction === p.id);
    if (!ts.length) rows.push([p.id, p.text, p.kind, p.core ? 1 : 0, p.status, '', '', '', '', ...dd.map(() => ''), '', '', '', '', '', '']);
    for (const t of ts) { const s = sById.get(t.study) || {}; const d = t.design || {}; rows.push([p.id, p.text, p.kind, p.core ? 1 : 0, p.status, t.study, s.title, s.year, t.label, ...dd.map((k) => d[k]), t.result?.direction, t.result?.support, t.result?.statistic, t.result?.quote, t.result?.page, t.status]); }
  }
  res.setHeader('content-type', 'text/csv'); res.setHeader('content-disposition', 'attachment; filename="designs.csv"');
  res.send(rows.map((r) => r.map(esc).join(',')).join('\n'));
}));
app.get('/api/admin/export', wrap(async (req, res) => { if (!process.env.ADMIN_TOKEN || req.get('x-admin-token') !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'admin token required' }); res.json(await exportAll()); }));

app.get('*', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// Listen first so Render sees an open port; the store connects in the background (with file fallback).
app.listen(PORT, () => console.log(`coverage-map listening on ${PORT} (model ${MODEL}, knowledge ${KNOWLEDGE_VERSION})`));
initStore().catch((e) => console.error('[store] init failed', e.message));
