import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initStore, storeMode, newField, listFields, getField, saveField, deleteField, logEvent, exportAll } from './store.js';
import { dimensions, designDimensions, cards, sources, benchmarks, cardById, groundingBlock, extractCitations, coachSystemBlocks, KNOWLEDGE_VERSION } from './knowledge.js';
import { EXTRACT_PROMPT, CONSOLIDATE_PROMPT, COMPARE_PROMPT, ASSUMPTIONS_PROMPT, parseJsonLoose } from './prompts.js';
import { searchOpenAlex, searchGroups, resolveDois, localCitations, parseExport, mergeStudies } from './corpus.js';

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
app.delete('/api/fields/:id', wrap(async (req, res) => { guard(req); const f = await getField(req.params.id); if (!f) return res.status(404).json({ error: 'Not found' }); await logEvent(req.params.id, 'field_delete', { name: f.name, studies: f.studies?.length, predictions: f.predictions?.length }); await deleteField(req.params.id); res.json({ ok: true }); }));

// ---- corpus ----
app.post('/api/openalex/search', wrap(async (req, res) => { guard(req); const { query, groups, fromYear, toYear, perPage, page, sort, maxPerCombo, scope } = req.body || {}; const allowed = { cites: 'cited_by_count:desc', recent: 'publication_date:desc', relevance: 'relevance_score:desc' }; const srt = allowed[sort] || allowed.cites;
  if (groups) { const r = await searchGroups({ groups, fromYear, toYear, sort: srt, maxPerCombo: Math.min(Number(maxPerCombo) || 200, 1000), scope }); if (req.body.fieldId) logEvent(req.body.fieldId, 'search', { queries: r.queries, total: r.total, unique: r.unique }).catch(() => {}); return res.json(r); }
  if (!query) return res.status(400).json({ error: 'query required' }); res.json(await searchOpenAlex({ query, fromYear, toYear, perPage, page, sort: srt, scope })); }));
app.post('/api/openalex/resolve', wrap(async (req, res) => { guard(req); res.json({ studies: await resolveDois(req.body?.dois || []) }); }));
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

// Which predictions match the researcher's inquiry? (step 3: reduce clutter; the person still decides)
app.post('/api/suggest-core', wrap(async (req, res) => {
  const { key } = resolveKey(req);
  const { fieldId, inquiry, predictions } = req.body || {};
  if (!inquiry?.statement || !predictions?.length) return res.status(400).json({ error: 'inquiry and predictions required' });
  const P = predictions.map((p) => `P ${p.id}: ${p.text}${p.statement ? ' — ' + p.statement : ''}${p.n ? ` [tested in ${p.n} stud${p.n === 1 ? 'y' : 'ies'}]` : ''}`).join('\n');
  const content = `A researcher stated this inquiry:\n<inquiry>${inquiry.statement}</inquiry>\n\nThese predictions were extracted from the papers:\n${P}\n\nFor EACH prediction, say whether it is central to the inquiry ("core"), related but secondary ("related"), or outside the inquiry ("outside"), with a reason of at most 15 words. Core predictions are the ones the inquiry is about; recurring across studies counts in favour. Return only JSON: {"items":[{"id":"...","verdict":"core|related|outside","reason":"..."}]}`;
  const out = await callModel({ key, system: [{ type: 'text', text: 'You help a researcher focus a field map on their inquiry. Be conservative: mark as core only predictions that the inquiry is plainly about.' }], content: [{ type: 'text', text: content }], maxTokens: 2500 });
  const json = parseJsonLoose(out.text);
  await logEvent(fieldId, 'suggest_core', { n: predictions.length, core: (json.items || []).filter((i) => i.verdict === 'core').length, usage: out.usage });
  res.json({ items: json.items || [] });
}));
// Plausible alternatives no study has used, per design dimension (step 7: the tool proposes, the person adds)
app.post('/api/alternatives', wrap(async (req, res) => {
  const { key } = resolveKey(req);
  const { fieldId, prediction, dims, judgments, gaps } = req.body || {};
  if (!prediction?.text || !dims?.length) return res.status(400).json({ error: 'prediction and dims required' });
  const D = dims.map((d) => `- ${d.id} (${d.name}): used so far: ${(d.options || []).join(' | ') || 'nothing recorded'}`).join('\n');
  const J = (judgments || []).map((j) => `- [${j.judgment}] ${j.text}`).join('\n') || '(none)';
  const content = `PREDICTION: ${prediction.text}${prediction.statement ? ' — ' + prediction.statement : ''}\n\nDESIGN DIMENSIONS AND THE OPTIONS PRIOR STUDIES USED:\n${D}\n\nTHE RESEARCHER'S JUDGMENTS OF WHAT THE FIELD ASSUMES\n${J}\n\nGAPS ALREADY NOTED: ${(gaps || []).join('; ') || '(none)'}\n\nPropose, for each dimension where it makes sense (skip dimensions where nothing credible is missing), 1 to 3 plausible, feasible alternative options that NO prior study used and that a reasonable scholar in this field could argue for. Prefer alternatives that would relax a questionable or violated assumption. Each option is a short label as it would appear in a design table (max 8 words) plus a reason (max 20 words); no abbreviations (write instrumental variable, difference-in-differences, fixed effects). Return only JSON: {"alternatives":[{"dim":"<dimension id>","option":"...","reason":"...","relaxes":"<assumption text or null>"}]}`;
  const out = await callModel({ key, system: systemBlocks(), content: [{ type: 'text', text: content }], maxTokens: 2500 });
  const json = parseJsonLoose(out.text);
  await logEvent(fieldId, 'alternatives', { prediction: prediction.id, n: (json.alternatives || []).length, usage: out.usage });
  res.json({ alternatives: (json.alternatives || []).filter((a) => a.dim && a.option) });
}));
// Assessment of the decision from the researcher's own judgments (step 5): the tool proposes a route, the person decides
app.post('/api/assess', wrap(async (req, res) => {
  const { key } = resolveKey(req);
  const { fieldId, prediction, judgments, tests } = req.body || {};
  if (!prediction?.text || !judgments?.length) return res.status(400).json({ error: 'prediction and judgments required' });
  const J = judgments.map((j) => `- [${String(j.judgment).toUpperCase()}] ${j.text}${j.source?.length ? ` (${j.source.join(', ')})` : ''}${j.relax ? ` — would be relaxed by: ${j.relax}` : ''}`).join('\n');
  const T = (tests || []).map((t) => `- ${t.study}: ${Object.entries(t.design || {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(', ') : v ?? 'n/a'}`).join('; ')} → ${t.result?.direction || '?'}/${t.result?.support || '?'}`).join('\n') || '(none)';
  const content = `PREDICTION: ${prediction.text}${prediction.statement ? ' — ' + prediction.statement : ''}\n\nTHE RESEARCHER'S OWN JUDGMENTS of the assumptions the existing designs rest on (these are the premise of your assessment; do not re-judge them):\n${J}\n\nEXISTING TESTS:\n${T}\n\nAssess, starting explicitly from the researcher's judgments, which route is warranted: (1) a multiverse on existing data (varies analytical choices; cannot repair a design flaw shared by all studies), (2) a replication of a specific study with one design decision varied, (3) a new design (when assumptions judged violated cannot be relaxed on the existing data), (4) stop. Rule: the more assumptions judged VIOLATED and tied to data source, sample, identification or measurement, the less a multiverse can settle; QUESTIONABLE assumptions tied to estimator, controls or functional form favour a multiverse. Write without abbreviations (instrumental variable, difference-in-differences, fixed effects, not IV, DiD, FE). Cite evidence cards in square brackets where they support a point. Return only JSON: {"summary":"two sentences that begin with 'You judged …'","routes":[{"route":"multiverse|replication|new design|stop","verdict":"recommended|possible|not warranted","why":"max 30 words"}],"violated_to_address":["assumption text", "..."]}`;
  const out = await callModel({ key, system: systemBlocks(), content: [{ type: 'text', text: content }], maxTokens: 1500 });
  const json = parseJsonLoose(out.text);
  await logEvent(fieldId, 'assess', { prediction: prediction.id, judged: judgments.length, routes: (json.routes || []).map((r) => `${r.route}:${r.verdict}`), usage: out.usage });
  res.json({ summary: json.summary || '', routes: json.routes || [], violated_to_address: json.violated_to_address || [], at: new Date().toISOString() });
}));
// Compare the researcher's sealed step-0 suspicions with the assumptions the tool unearthed WITHOUT seeing them.
// The unearthing call never receives the priors, so this is a disconfirmation check, not an echo.
app.post('/api/priors-check', wrap(async (req, res) => {
  const { key } = resolveKey(req);
  const { fieldId, prediction, priors, assumptions, tests } = req.body || {};
  if (!priors || !assumptions?.length) return res.status(400).json({ error: 'priors and assumptions required' });
  const A = assumptions.map((x, i) => `A${i + 1}: ${x.text}${x.source?.length ? ` (${x.source.join(', ')})` : ''}`).join('\n');
  const T = (tests || []).map((t) => `- ${t.study}: ${Object.entries(t.design || {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(', ') : v ?? 'n/a'}`).join('; ')} → ${t.result?.direction || '?'}/${t.result?.support || '?'}`).join('\n') || '(none)';
  const content = `PREDICTION: ${prediction?.text || ''}\n\nBEFORE reading any paper, the researcher wrote down what they SUSPECT the field takes for granted:\n<suspicions>${String(priors).slice(0, 3000)}</suspicions>\n\nINDEPENDENTLY of that text, the assumptions unearthed from the papers' designs were:\n${A}\n\nThe tests:\n${T}\n\nYour job is adversarial: split the suspicions into separate claims and, for each, say whether the papers' designs SUPPORT it (an unearthed assumption or the designs match it), CONTRADICT it (the designs or results show otherwise), or do NOT ADDRESS it (nothing in these papers bears on it). Do not agree out of politeness; where the suspicion is vaguer or stronger than what the papers show, say so in the evidence field. Write without abbreviations. Return only JSON: {"items":[{"prior":"one suspicion in the researcher's words","verdict":"supported|contradicted|not addressed","evidence":"max 30 words naming the assumption (A1…) or study"}],"not_mentioned":["unearthed assumption the researcher did not mention", "..."]}`;
  const out = await callModel({ key, system: [{ type: 'text', text: 'You check a researcher\'s prior beliefs about a literature against evidence extracted from that literature. You are an adversarial reviewer: your value lies in disagreeing when the evidence does not support the belief.' }], content: [{ type: 'text', text: content }], maxTokens: 1800 });
  const json = parseJsonLoose(out.text);
  await logEvent(fieldId, 'priors_check', { prediction: prediction?.id, n: (json.items || []).length, verdicts: (json.items || []).map((x) => x.verdict), usage: out.usage });
  res.json({ items: json.items || [], not_mentioned: json.not_mentioned || [] });
}));
// Push back on the researcher's judgments: argue the other side where there is a case (step 5). The person keeps or changes each judgment; both are logged.
app.post('/api/challenge', wrap(async (req, res) => {
  const { key } = resolveKey(req);
  const { fieldId, prediction, assumptions, tests } = req.body || {};
  const judged = (assumptions || []).filter((a) => a.judgment);
  if (!prediction?.text || !judged.length) return res.status(400).json({ error: 'prediction and judged assumptions required' });
  const A = judged.map((a) => `- key ${a.key}: "${a.text}" | researcher's judgment: ${a.judgment.toUpperCase()}${a.note ? ` (their reason: ${a.note})` : ''} | your earlier sensitivity rating: ${a.sensitivity ?? '?'} | from: ${(a.source || []).join(', ')} | would be relaxed by: ${a.relaxed_by || '?'}`).join('\n');
  const T = (tests || []).map((t) => `- ${t.study}: ${Object.entries(t.design || {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(', ') : v ?? 'n/a'}`).join('; ')} → ${t.result?.direction || '?'}/${t.result?.support || '?'}`).join('\n') || '(none)';
  const content = `PREDICTION: ${prediction.text}${prediction.statement ? ' — ' + prediction.statement : ''}\n\nHOW THE RESEARCHER JUDGED EACH ASSUMPTION\n${A}\n\nTHE TESTS:\n${T}\n\nYou are the researcher's sparring partner, not their echo. For EACH judged assumption, decide whether you AGREE or DISAGREE with the researcher's judgment, and make the strongest honest case for the OTHER side in at most 45 words, grounded in the designs and results above and in the evidence cards (cite ids in square brackets). Disagree whenever a reasonable methodologist would: an assumption judged "reasonable" that all studies share, that your sensitivity rating marks as decisive, or that the designs cannot have tested, deserves a challenge; an assumption judged "violated" that the designs do address deserves a defence. Agreeing with everything is a failure. Write without abbreviations. Return only JSON: {"items":[{"key":"...","stance":"agree|disagree","case":"...","would_change_if":"what evidence from these or new studies would change your view (max 25 words)"}]}`;
  const out = await callModel({ key, system: systemBlocks(), content: [{ type: 'text', text: content }], maxTokens: 2500 });
  const json = parseJsonLoose(out.text);
  const items = (json.items || []).filter((x) => x.key && x.stance);
  await logEvent(fieldId, 'challenge', { prediction: prediction.id, judged: judged.length, disagree: items.filter((x) => x.stance === 'disagree').length, usage: out.usage });
  res.json({ items });
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
app.post('/api/event', wrap(async (req, res) => { const { fieldId, type, payload } = req.body || {}; const ok = ['coach_open', 'coach_close', 'nudge_shown', 'nudge_dismissed', 'loop_back', 'decision', 'judgment', 'allocation', 'run', 'search', 'many_mode']; if (!ok.includes(type)) return res.status(400).json({ error: 'unknown event' }); await logEvent(fieldId, type, payload || {}); res.json({ ok: true }); }));
app.post('/api/flag', wrap(async (req, res) => { const { fieldId, cardId, step, note } = req.body || {}; await logEvent(fieldId, 'citation_flag', { cardId: String(cardId || '').slice(0, 40), step, note: String(note || '').slice(0, 500) }); res.json({ ok: true }); }));

// ---- exports ----
app.get('/api/fields/:id/export.json', wrap(async (req, res) => { const f = await getField(req.params.id); if (!f) return res.status(404).end(); res.setHeader('content-disposition', `attachment; filename="${(f.name || 'field').replace(/[^\w-]+/g, '_')}.json"`); res.json(f); }));
app.get('/api/fields/:id/judgments.csv', wrap(async (req, res) => {
  const f = await getField(req.params.id); if (!f) return res.status(404).end();
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['prediction_id', 'prediction', 'assumption_key', 'assumption', 'judge', 'role', 'judgment', 'note', 'at']];
  for (const [pid, ab] of Object.entries(f.assumptions_by_prediction || {})) {
    const p = (f.predictions || []).find((q) => q.id === pid) || {};
    (ab.assumptions || []).forEach((a, i) => { const key = a.key || String(i); rows.push([pid, p.text, key, a.text, 'owner', 'owner', a.judgment || '', a.note || '', '']); for (const j of (f.judges || []).filter((x) => x.prediction === pid && x.judgments)) rows.push([pid, p.text, key, a.text, j.name, 'colleague', j.judgments[key] || '', (j.notes || {})[key] || '', j.at || '']); });
  }
  res.setHeader('content-type', 'text/csv'); res.setHeader('content-disposition', 'attachment; filename="judgments.csv"');
  res.send(rows.map((r) => r.map(esc).join(',')).join('\n'));
}));
app.get('/api/fields/:id/runs.csv', wrap(async (req, res) => {
  const f = await getField(req.params.id); if (!f) return res.status(404).end();
  const esc = (v) => `"${String(Array.isArray(v) ? v.join('; ') : v ?? '').replace(/"/g, '""')}"`;
  const dd = designDimensions.map((d) => d.id);
  const rows = [['run_id', 'prediction_id', 'prediction', 'spec_id', ...dd, 'team', 'analyst', 'estimate', 'se', 'n', 'direction', 'support', 'notes', 'submitted']];
  const teams = new Map((f.teams || []).map((t) => [t.id, t.name]));
  const only = req.query.prediction; const slug = (t) => String(t || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  for (const r of (f.runs || []).filter((x) => !only || x.prediction === only)) { const p = (f.predictions || []).find((q) => q.id === r.prediction) || {}; rows.push([r.id, r.prediction, p.text, r.spec_id, ...dd.map((k) => (r.spec || {})[k]), teams.get(r.team) || r.team, r.by, r.estimate, r.se, r.n, r.direction, r.support, r.notes, r.at]); }
  const pn = only ? ((f.predictions || []).find((q) => q.id === only) || {}).text : null;
  res.setHeader('content-type', 'text/csv'); res.setHeader('content-disposition', `attachment; filename="results-${slug(pn || f.name)}.csv"`);
  res.send(rows.map((r) => r.map(esc).join(',')).join('\n'));
}));
app.get('/api/fields/:id/specs.csv', wrap(async (req, res) => {
  const f = await getField(req.params.id); if (!f) return res.status(404).end();
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const dd = designDimensions.map((d) => d.id);
  const rows = [['prediction_id', 'prediction', 'spec_id', ...dd, 'prior_studies', 'assigned_to']];
  const teams = new Map((f.teams || []).map((t) => [t.id, t.name]));
  const assigned = {}; for (const [tid, ids] of Object.entries(f.allocation?.assignments || {})) for (const sid of ids) (assigned[sid] ||= []).push(teams.get(tid) || tid);
  const only = req.query.prediction; const slug = (t) => String(t || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  for (const [pid, sp] of Object.entries(f.space || {}).filter(([k]) => !only || k === only)) {
    const p = (f.predictions || []).find((q) => q.id === pid) || {};
    const dims = dd.filter((k) => sp.dims?.[k]?.include && (sp.dims[k].options || []).length);
    let combos = [[]]; for (const k of dims) combos = combos.flatMap((c) => sp.dims[k].options.map((o, i) => [...c, [k, o, i]]));
    if (combos.length > 10000) continue;
    for (const c of combos) { const id = `${pid}:${c.map((z) => z[2]).join('.')}`; const spec = Object.fromEntries(c.map((z) => [z[0], z[1]])); const prior = (f.tests || []).filter((t) => t.prediction === pid && dims.every((k) => String(Array.isArray(t.design?.[k]) ? t.design[k].join(', ') : t.design?.[k] || '').trim() === spec[k])).map((t) => t.study); rows.push([pid, p.text, id, ...dd.map((k) => spec[k] ?? '(fixed)'), prior.join('; '), (assigned[id] || []).join('; ')]); }
  }
  const pn = only ? ((f.predictions || []).find((q) => q.id === only) || {}).text : null;
  res.setHeader('content-type', 'text/csv'); res.setHeader('content-disposition', `attachment; filename="specifications-${slug(pn || f.name)}.csv"`);
  res.send(rows.map((r) => r.map(esc).join(',')).join('\n'));
}));
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
app.listen(PORT, () => console.log(`epistemap listening on ${PORT} (model ${MODEL}, knowledge ${KNOWLEDGE_VERSION})`));
initStore().catch((e) => console.error('[store] init failed', e.message));
