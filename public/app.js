/* Coverage Map front end. Plain JS, no build step. One field = one JSON document kept in `F`. */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
let CFG = { dimensions: [] }, F = null, VERSION = 0, STEP = 'corpus', saveTimer = null, KNOW = null;
const PDF = {}; // studyId -> base64, kept only in memory for this tab
const DIM = () => CFG.dimensions;
const dimName = (id) => (DIM().find((d) => d.id === id) || {}).name || id;

// ---------- transport ----------
function headers() {
  const h = { 'content-type': 'application/json' };
  const code = sessionStorage.getItem('cm.code'); const key = sessionStorage.getItem('cm.key');
  if (code) h['x-access-code'] = code; if (key) h['x-user-key'] = key;
  return h;
}
async function gzipBody(text) {
  if (typeof CompressionStream === 'undefined' || text.length < 4000) return null;
  try { const cs = new CompressionStream('gzip'); const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(text)); w.close(); return await new Response(cs.readable).arrayBuffer(); } catch { return null; }
}
async function api(path, body, method, opts = {}) {
  let payload = body ? JSON.stringify(body) : undefined; const h = headers();
  if (payload && opts.compress) { const gz = await gzipBody(payload); if (gz) { payload = gz; h['content-encoding'] = 'gzip'; } }
  const r = await fetch(path, { method: method || (body ? 'POST' : 'GET'), headers: h, body: payload, keepalive: !!opts.keepalive });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), err ? 6000 : 2500); }
function busy(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; } else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; } }

// ---------- persistence ----------
let lastSaved = '', saving = false, saveAgain = false;
function markDirty() { const e = $('#saveState'); e.textContent = 'Saving…'; e.className = 'save-state dirty'; clearTimeout(saveTimer); saveTimer = setTimeout(save, 350); updateCounts(); }
async function save() {
  if (!F) return;
  if (saving) { saveAgain = true; return; }
  const snap = JSON.stringify(F);
  if (snap === lastSaved) { $('#saveState').textContent = 'Saved'; $('#saveState').className = 'save-state'; return; }
  saving = true;
  try { const { version } = await api(`/api/fields/${F.id}`, { doc: F, version: VERSION }, 'PUT', { compress: true }); VERSION = version; lastSaved = snap; $('#saveState').textContent = 'Saved'; $('#saveState').className = 'save-state'; }
  catch (e) { $('#saveState').textContent = 'Not saved'; $('#saveState').className = 'save-state err'; toast(e.message, true); }
  finally { saving = false; if (saveAgain) { saveAgain = false; save(); } }
}
window.addEventListener('pagehide', () => { if (F && JSON.stringify(F) !== lastSaved) { clearTimeout(saveTimer); api(`/api/fields/${F.id}`, { doc: F, version: VERSION }, 'PUT', { keepalive: true }).catch(() => {}); } });

// ---------- routing ----------
async function route() {
  const h = location.hash.replace(/^#/, '');
  const m = /^field\/([^/]+)(?:\/(\w+))?/.exec(h);
  if (!m) { F = null; $('#work').hidden = true; $('#home').hidden = false; $('#fieldName').hidden = true; return renderHome(); }
  if (!F || F.id !== m[1]) { F = await api(`/api/fields/${m[1]}`); VERSION = F.version || 1; lastSaved = JSON.stringify(F); }
  STEP = m[2] || 'corpus';
  $('#home').hidden = true; $('#work').hidden = false; $('#fieldName').textContent = F.name; $('#fieldName').hidden = false;
  document.querySelectorAll('#steps li').forEach((li) => li.classList.toggle('active', li.dataset.step === STEP));
  updateCounts(); renderStep(); $('#panel').scrollTop = 0; window.scrollTo(0, 0); renderStarters(); renderChat();
}
window.addEventListener('hashchange', route);
$('#steps').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) location.hash = `field/${F.id}/${li.dataset.step}`; });
$('#exportJson').addEventListener('click', (e) => { e.preventDefault(); if (F) location.href = `/api/fields/${F.id}/export.json`; });

function updateCounts() {
  if (!F) return;
  const conf = (a) => a.filter((x) => x.status === 'confirmed').length;
  const core = F.studies.filter((s) => s.core).length, read = F.studies.filter((s) => s.extraction).length;
  const set = (id, txt, done) => { const el = $('#' + id); if (el) { el.textContent = txt; el.closest('li').classList.toggle('done', !!done); } };
  set('c-corpus', F.studies.length ? `${F.studies.length} studies · ${core} core` : 'not started', core);
  set('c-studies', read ? `${read} read` : 'no PDFs yet', read);
  const coreP = F.predictions.filter((x) => x.status === 'confirmed' && x.core).length;
  set('c-predictions', F.predictions.length ? `${conf(F.predictions)}/${F.predictions.length} confirmed · ${coreP} core` : 'nothing to review', conf(F.predictions));
  set('c-designs', F.tests.length ? `${conf(F.tests)}/${F.tests.length} tests confirmed` : 'no tests yet', conf(F.tests));
  set('c-choices', F.choices.length ? `${F.choices.length} choices${F.matches.length ? ' · aligned' : ''}` : 'no choices yet', F.matches.length);
  set('c-export', '', false);
}

// ---------- home ----------
async function renderHome() {
  const list = await api('/api/fields');
  $('#fieldCount').textContent = list.length ? `${list.length} field${list.length > 1 ? 's' : ''}` : ''; $('#fieldList').innerHTML = list.length ? list.map((f) => `<li><a href="#field/${f.id}">${esc(f.name)}</a><span class="muted small">${f.studies} studies · ${f.predictions ?? 0} predictions · ${new Date(f.updated).toLocaleDateString()}</span><a class="small" href="#field/${f.id}">Open →</a></li>`).join('') : '<li class="empty">No fields yet. Name one above to start.</li>';
}
$('#newField').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { const f = await api('/api/fields', { name: $('#newName').value.trim() }); location.hash = `field/${f.id}`; } catch (err) { toast(err.message, true); }
});

// ---------- settings ----------
$('#settingsBtn').addEventListener('click', () => { $('#accessCode').value = sessionStorage.getItem('cm.code') || ''; $('#userKey').value = sessionStorage.getItem('cm.key') || ''; $('#cfgInfo').textContent = `Model: ${CFG.model || '?'} · server key: ${CFG.serverKeyAvailable ? 'available' : 'not configured'} · storage: ${CFG.store === 'postgres' ? 'database (shared, persistent)' : 'files on the server (not persistent on Render)'} · max PDF ${CFG.maxPdfMb} MB · evidence base v${CFG.knowledgeVersion}`; $('#settings').showModal(); });
$('#settings form').addEventListener('submit', () => { sessionStorage.setItem('cm.code', $('#accessCode').value.trim()); sessionStorage.setItem('cm.key', $('#userKey').value.trim()); });

// ---------- helpers ----------
const study = (id) => F.studies.find((s) => s.id === id);
const claim = (id) => F.claims.find((c) => c.id === id);
const authorsOf = (cit) => (String(cit || '').split(/\s\(\d{4}\)/)[0] || '').slice(0, 120);
const short = (s) => s ? `${(s.authors || '').split(',')[0] || 'Unknown'}${s.year ? ` (${s.year})` : ''}` : '?';
const statusBtns = (kind, id, st) => `<span class="actions"><span class="status ${st}">${st}</span>${st !== 'confirmed' ? `<button class="small" data-act="confirm" data-kind="${kind}" data-id="${id}">Confirm</button>` : ''}${st !== 'rejected' ? `<button class="small ghost" data-act="reject" data-kind="${kind}" data-id="${id}">Reject</button>` : ''}<button class="small ghost" data-act="edit" data-kind="${kind}" data-id="${id}">Edit</button></span>`;
function readPdf(file) { return new Promise((res, rej) => { if (file.size > CFG.maxPdfMb * 1024 * 1024) return rej(new Error(`PDF larger than ${CFG.maxPdfMb} MB`)); const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); }); }
function modal(html, onOpen) { $('#modalBody').innerHTML = html; $('#modal').showModal(); onOpen && onOpen($('#modalBody')); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.dataset.close !== undefined) $('#modal').close(); });

// Hand-off to Replication Navigator: open it with the claim and the assumption to vary pre-filled.
const DD = () => CFG.designDimensions || [];
const ddName = (id) => (DD().find((d) => d.id === id) || {}).name || id;
const pred = (id) => F.predictions.find((p) => p.id === id);
const testsOf = (pid) => F.tests.filter((t) => t.prediction === pid && t.status !== 'rejected');
const typeBadge = (s) => s.paper_type ? `<span class="status ${s.paper_type === 'empirical' ? 'confirmed' : 'candidate'}">${esc(s.paper_type)}</span>` : (s.is_review ? '<span class="status candidate">review?</span>' : '');

// Hand-off to Replication Navigator: open it with the prediction, the original study and the design range pre-filled.
function planLink(p, focus) {
  if (!CFG.navigatorUrl) return '';
  const ts = testsOf(p.id); const t0 = ts[0]; const s = t0 ? study(t0.study) : study(p.study);
  const citation = s ? [s.authors, s.year ? `(${s.year})` : '', s.title, s.venue, s.doi ? `https://doi.org/${s.doi}` : ''].filter(Boolean).join('. ') : '';
  const range = DD().map((d) => { const opts = [...new Set(ts.map((t) => (t.design || {})[d.id]).filter(Boolean).map((v) => Array.isArray(v) ? v.join(', ') : v))]; return opts.length > 1 ? `${d.name}: ${opts.join(' | ')}` : null; }).filter(Boolean).join('; ');
  const coverage = `Tested in ${ts.length} stud${ts.length === 1 ? 'y' : 'ies'}: ${ts.map((t) => `${short(study(t.study))} (${t.result?.direction || '?'}, ${t.result?.support || '?'})`).join('; ')}. Design choices that vary across studies: ${range || 'none recorded'}.`;
  const plan = { field: F.name, claimId: p.id, assumptionId: focus?.id || null, citation, claim: p.statement || p.text, dimension: focus ? ddName(focus.id) : 'research design', assumption: focus ? `${ddName(focus.id)}: options used so far: ${focus.options.join(' | ')}` : `Which design decision matters most for "${p.text}"?`, coverage };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(plan)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `<a class="plan-link" href="${CFG.navigatorUrl}/?plan=${b64}" target="_blank" rel="noopener" title="Open Replication Navigator with this prediction pre-filled">Plan this test →</a>`;
}

// ---------- steps ----------
function renderStep() {
  // Replace the panel node so listeners added by the previous render are dropped (they would otherwise stack).
  const old = $('#panel'); const p = old.cloneNode(false); old.replaceWith(p);
  ({ corpus: renderCorpus, studies: renderStudies, predictions: renderPredictions, designs: renderDesigns, choices: renderChoices, export: renderExport }[STEP] || renderCorpus)(p);
}

/* 1 CORPUS */
function renderCorpus(p) {
  const core = F.studies.filter((s) => s.core).length;
  p.innerHTML = `
  <h2>1. Bound the field and choose the core studies</h2>
  <div class="intro">Build a corpus, then mark the <strong>core empirical studies</strong>: the ones whose predictions and designs the map will cover. Heuristics from the team: the seminal studies, the most recent ones, and those with a rising citation trajectory; reviews and conceptual papers are useful for finding predictions but are flagged, because the map is built from empirical tests. <em>Cites/yr</em> adjusts citations for age; <em>local</em> counts citations from within the corpus (bibliographic coupling).</div>
  <div class="grid2">
    <div class="card"><h3>Search OpenAlex</h3>
      <form id="oa"><label>Query <span class="muted">(quotes for phrases; OR, AND, NOT)</span><input name="q" placeholder='e.g. greenwashing OR "green washing" OR brownwashing' required></label>
      <div class="row"><label style="flex:1">From year<input name="from" type="number" placeholder="1990"></label><label style="flex:1">To year<input name="to" type="number" placeholder="2026"></label><label style="flex:1">Sort<select name="sort"><option value="cites">Most cited</option><option value="recent">Most recent</option><option value="relevance">Relevance</option></select></label><label style="flex:1">Results<input name="n" type="number" value="100" min="10" max="200"></label></div>
      <button>Search</button></form>
      <div id="oaOut" class="small"></div></div>
    <div class="card"><h3>Upload an export</h3>
      <p class="small muted">Scopus CSV, Web of Science tab-delimited (savedrecs.txt), or BibTeX. Only titles, authors, years, DOIs, venues, citation counts and abstracts are read.</p>
      <input type="file" id="expFile" accept=".csv,.txt,.bib,.tsv">
      <div id="expOut" class="small"></div>
      <h3 style="margin-top:1rem">Add a study by hand</h3>
      <form id="manual" class="row"><input name="title" placeholder="Title" required style="flex:2"><input name="authors" placeholder="Authors" style="flex:1"><input name="year" placeholder="Year" type="number" style="width:90px"><input name="doi" placeholder="DOI" style="flex:1"><button class="small">Add</button></form>
    </div>
  </div>
  <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Corpus: ${F.studies.length} studies, ${core} core</h3><span class="actions"><button class="small ghost" id="localCites">Compute local citations</button><button class="small ghost" id="sortCites">Sort by citations</button><button class="small ghost" id="sortCpy">Sort by cites/yr</button><button class="small ghost" id="sortYear">Sort by year</button></span></div>
  ${F.studies.length ? `<table><tr><th>Core</th><th>Study</th><th>Year</th><th>Venue</th><th>Cited</th><th>Cites/yr</th><th>Local</th><th></th></tr>${F.studies.map((s) => `<tr class="${s.core ? 'core' : ''}"><td><input type="checkbox" data-core="${s.id}" ${s.core ? 'checked' : ''}></td><td><strong>${esc(s.title)}</strong> ${typeBadge(s)}<br><span class="muted small">${esc(s.authors)}${s.doi ? ` · <a href="https://doi.org/${esc(s.doi)}" target="_blank" rel="noopener">doi</a>` : ''}</span>${s.abstract ? `<details><summary class="small">abstract</summary><span class="small">${esc(s.abstract)}</span></details>` : ''}</td><td>${s.year || ''}</td><td class="small">${esc(s.venue)}</td><td>${s.cited_by ?? ''}</td><td>${s.cites_per_year ?? ''}</td><td>${s.local_cites || 0}</td><td><button class="small ghost" data-rm="${s.id}">×</button></td></tr>`).join('')}</table>` : '<div class="empty-state"><h3>Corpus is empty</h3><p>Search OpenAlex, upload an export, or add a study by hand.</p></div>'}</div>`;
  let lastSearch = null;
  $('#oa').addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(e.target); const btn = e.target.querySelector('button'); busy(btn, true, 'Searching…');
    try { lastSearch = { query: fd.get('q'), fromYear: fd.get('from') || null, toYear: fd.get('to') || null, perPage: Number(fd.get('n')) || 100, sort: fd.get('sort'), page: 1 }; const r = await api('/api/openalex/search', lastSearch); showCandidates($('#oaOut'), r.results, `${r.total.toLocaleString()} matches in OpenAlex; showing ${r.results.length}.`, async () => { lastSearch.page += 1; const r2 = await api('/api/openalex/search', lastSearch); return r2.results; }); }
    catch (err) { toast(err.message, true); } finally { busy(btn, false); }
  });
  $('#expFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const text = await f.text(); const r = await fetch('/api/corpus/parse', { method: 'POST', headers: { ...headers(), 'content-type': 'text/plain', 'x-filename': f.name }, body: text }); const j = await r.json(); if (!r.ok) throw new Error(j.error); showCandidates($('#expOut'), j.studies, `${j.studies.length} records read from ${esc(f.name)}.`); }
    catch (err) { toast(err.message, true); }
  });
  $('#manual').addEventListener('submit', (e) => { e.preventDefault(); const fd = new FormData(e.target); F.studies.push({ id: uid('s_'), doi: fd.get('doi') || null, title: fd.get('title'), authors: fd.get('authors'), year: Number(fd.get('year')) || null, venue: '', cited_by: null, local_cites: 0, references: [], source: 'manual', abstract: '', core: true, status: 'core', extraction: null, added: new Date().toISOString() }); markDirty(); renderStep(); });
  p.addEventListener('change', (e) => { const id = e.target.dataset.core; if (id) { const s = study(id); s.core = e.target.checked; s.status = s.core ? 'core' : 'candidate'; markDirty(); renderStep(); } });
  p.addEventListener('click', async (e) => {
    if (e.target.dataset.rm) { F.studies = F.studies.filter((s) => s.id !== e.target.dataset.rm); markDirty(); return renderStep(); }
    if (e.target.id === 'localCites') { const r = await api('/api/corpus/local-cites', { studies: F.studies }); F.studies = r.studies; markDirty(); renderStep(); toast('Local citations computed (needs OpenAlex ids to find links).'); }
    if (e.target.id === 'sortCites') { F.studies.sort((a, b) => (b.local_cites - a.local_cites) || ((b.cited_by || 0) - (a.cited_by || 0))); markDirty(); renderStep(); }
    if (e.target.id === 'sortCpy') { F.studies.sort((a, b) => (b.cites_per_year || 0) - (a.cites_per_year || 0)); markDirty(); renderStep(); }
    if (e.target.id === 'sortYear') { F.studies.sort((a, b) => (b.year || 0) - (a.year || 0)); markDirty(); renderStep(); }
  });
}
function showCandidates(el, list, note, more) {
  el._list = list;
  const row = (s, i) => `<tr><td><input type="checkbox" data-i="${i}"></td><td>${esc(s.title)} ${s.is_review ? '<span class="status candidate">review?</span>' : ''}<br><span class="muted">${esc(s.authors)} · ${s.year || ''} · ${esc(s.venue)}</span></td><td>${s.cited_by ?? ''}</td><td>${s.cites_per_year ?? ''}</td></tr>`;
  el.innerHTML = `<p>${note} <button class="small" id="addAll">Add all to corpus</button> <button class="small ghost" id="addSel">Add selected</button> ${more ? '<button class="small ghost" id="more">Load more</button>' : ''}</p><div style="max-height:360px;overflow:auto"><table><tr><th></th><th>Study</th><th>Cited</th><th>Cites/yr</th></tr><tbody id="candRows">${list.map(row).join('')}</tbody></table></div>`;
  el.onclick = async (e) => {
    let pick = null;
    if (e.target.id === 'more' && more) { busy(e.target, true, 'Loading…'); try { const extra = await more(); list.push(...extra); $('#candRows', el).insertAdjacentHTML('beforeend', extra.map((s, i) => row(s, list.length - extra.length + i)).join('')); } catch (err) { toast(err.message, true); } finally { busy(e.target, false); } return; }
    if (e.target.id === 'addAll') pick = list;
    if (e.target.id === 'addSel') pick = [...el.querySelectorAll('input:checked')].map((c) => list[c.dataset.i]);
    if (!pick) return;
    const r = await api('/api/corpus/merge', { existing: F.studies, incoming: pick }); F.studies = r.studies; markDirty(); toast(`${r.added} added`); renderStep();
  };
}

/* 2 STUDIES: upload PDFs and extract predictions, designs, choices */
function renderStudies(p) {
  const list = F.studies.filter((s) => s.core);
  p.innerHTML = `<h2>2. Read the core studies</h2>
  <div class="intro">Upload each core study's PDF. The model classifies the paper, extracts its <strong>predictions</strong> (what it set out to test, at the construct level), the <strong>research design</strong> used to test each one, the <strong>result</strong>, and the analytical choices, each with a quote and page. Nothing enters the map until you confirm it in step 3. PDFs are read once and not stored.</div>
  <div class="card"><h3>Add a study directly from a PDF</h3><p class="small muted">If the paper is not in the corpus yet, drop it here: the citation is taken from the paper.</p><div class="drop" id="dropNew">Drop a PDF here or <label style="display:inline;color:var(--accent);cursor:pointer"><u>choose a file</u><input type="file" accept="application/pdf" id="fileNew" hidden></label></div><div id="newOut"></div></div>
  ${list.length ? `<table><tr><th>Core study</th><th>Extraction</th><th></th></tr>${list.map((s) => `<tr><td><strong>${esc(s.title)}</strong> ${typeBadge(s)}<br><span class="muted small">${esc(s.authors)} · ${s.year || ''}</span></td><td class="small">${s.extraction ? `${(s.extraction.predictions || []).length} predictions (${(s.extraction.predictions || []).filter((x) => x.core).length} core) · ${(s.extraction.predictions || []).filter((x) => x.test).length} tested · ${(s.extraction.choices || []).length} choices${s.imported ? ' · <span class="status confirmed">imported</span>' : ''}<br><span class="muted">${esc(s.extraction.summary)}</span>` : '<span class="muted">not read yet</span>'}</td><td><label><button class="small" onclick="this.nextElementSibling.click()">${s.extraction ? 'Re-read PDF' : 'Upload PDF'}</button><input type="file" accept="application/pdf" hidden data-extract="${s.id}"></label>${s.extraction && !s.imported ? `<button class="small" data-import="${s.id}">Import to map</button>` : ''}${s.extraction ? `<button class="small ghost" data-view="${s.id}">View</button>` : ''}</td></tr>`).join('')}</table>` : `<div class="empty-state"><h3>No core studies yet</h3><p>Mark studies as core in step 1, or drop a PDF above to add one directly.</p><button class="ghost small" onclick="location.hash='field/${F.id}/corpus'">Go to step 1</button></div>`}`;
  const dz = $('#dropNew');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); }); dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) extractFile(f, null, $('#newOut')); });
  $('#fileNew').addEventListener('change', (e) => { if (e.target.files[0]) extractFile(e.target.files[0], null, $('#newOut')); });
  p.addEventListener('change', (e) => { if (e.target.dataset.extract && e.target.files[0]) extractFile(e.target.files[0], e.target.dataset.extract, e.target.closest('td')); });
  p.addEventListener('click', async (e) => {
    if (e.target.dataset.import) { busy(e.target, true, 'Merging…'); try { const n = await importExtraction(e.target.dataset.import); toast(`${n.added} new prediction${n.added === 1 ? '' : 's'}, ${n.merged} merged with existing ones. Review them in step 3.`); } catch (err) { toast(err.message, true); } renderStep(); }
    if (e.target.dataset.view) viewExtraction(study(e.target.dataset.view));
  });
}
async function extractFile(file, studyId, out) {
  out.innerHTML = `<div class="progress"><i></i></div><span class="small muted">Reading ${esc(file.name)} with the model (30–90 s)…</span>`;
  try {
    const b64 = await readPdf(file);
    const r = await api('/api/extract', { pdfBase64: b64, fieldId: F.id, studyId });
    let s = studyId ? study(studyId) : null;
    if (!s) { s = { id: uid('s_'), doi: null, title: r.extraction.citation || file.name, authors: authorsOf(r.extraction.citation), year: Number(/\((\d{4})\)/.exec(r.extraction.citation || '')?.[1]) || null, venue: '', cited_by: null, local_cites: 0, references: [], source: 'pdf', abstract: '', core: true, status: 'core', extraction: null, added: new Date().toISOString() }; F.studies.push(s); }
    s.extraction = r.extraction; s.paper_type = r.extraction.paper_type || null; s.imported = false; s.extracted_with = r.model; PDF[s.id] = b64;
    if (r.stop === 'max_tokens') toast('The extraction was cut off (very long paper). Check the last items.', true);
    markDirty(); renderStep(); toast('Extracted. Review, then import to the map.');
  } catch (e) { out.innerHTML = `<span class="small" style="color:var(--bad)">${esc(e.message)}</span>`; }
}
// Import: consolidate the paper's predictions with the canonical list (same X → Y = same prediction), then add tests and choices.
async function importExtraction(sid) {
  const s = study(sid); const x = s.extraction; if (!x || s.imported) return { added: 0, merged: 0 };
  const incoming = (x.predictions || []).map((pr) => ({ key: pr.key, text: pr.text, kind: pr.kind }));
  const canonical = F.predictions.filter((p) => p.status !== 'rejected').map((p) => ({ id: p.id, text: p.text, kind: p.kind }));
  const { map } = await api('/api/consolidate', { fieldId: F.id, canonical, incoming });
  const byKey = new Map(map.map((m) => [m.n, m]));
  let added = 0, merged = 0;
  for (const pr of x.predictions || []) {
    const m = byKey.get(pr.key); let pid = m?.c && pred(m.c) ? m.c : null;
    if (pid) { merged++; const P = pred(pid); P.sources = [...new Set([...(P.sources || []), sid])]; if (pr.core) P.core_votes = (P.core_votes || 0) + 1; }
    else { pid = uid('p_'); added++; F.predictions.push({ id: pid, study: sid, sources: [sid], label: pr.label || null, text: pr.text, statement: pr.statement || '', x: pr.x, y: pr.y, direction: pr.direction, kind: pr.kind || 'main', core: !!pr.core, core_votes: pr.core ? 1 : 0, builds_on: pr.builds_on || [], quote: pr.quote || '', page: pr.page || null, status: 'ai', merge_note: m?.note || null }); }
    if (pr.test) { const t = pr.test; F.tests.push({ id: uid('t_'), prediction: pid, study: sid, label: pr.label || null, design: { data_source: t.data_source, sample: t.sample, period: t.period, iv_measure: t.iv_measure, dv_measure: t.dv_measure, estimator: t.estimator, controls: t.controls || [], functional_form: t.functional_form, identification: t.identification }, result: { direction: t.result_direction, support: t.support, statistic: t.statistic, quote: t.quote || '', page: t.page || null }, robustness: t.robustness || [], status: 'ai' }); }
  }
  for (const ch of x.choices || []) F.choices.push({ id: uid('h_'), study: sid, key: ch.key, category: ch.category, description: ch.description, options: ch.options || [], alternatives_reported: !!ch.alternatives_reported, quote: ch.quote || '', page: ch.page || null, status: 'ai' });
  s.imported = true; markDirty();
  return { added, merged };
}
function viewExtraction(s) {
  const x = s.extraction;
  modal(`<h3>${esc(x.citation)}</h3><p>${typeBadge(s)} ${esc(x.summary)}</p>${(x.predictions || []).map((pr) => `<h4>${pr.core ? '★ ' : ''}${pr.label ? esc(pr.label) + ': ' : ''}${esc(pr.text)} <span class="dim">${esc(pr.kind)}</span></h4><p class="small">${esc(pr.statement)}<br><span class="quote">“${esc(pr.quote)}” (p. ${pr.page})</span></p>${pr.test ? `<table>${DD().map((d) => `<tr><td class="small"><b>${esc(d.name)}</b></td><td class="small">${esc(Array.isArray(pr.test[d.id]) ? pr.test[d.id].join('; ') : pr.test[d.id] ?? '—')}</td></tr>`).join('')}<tr><td class="small"><b>Result</b></td><td class="small">${esc(pr.test.result_direction)}, ${esc(pr.test.support)}; ${esc(pr.test.statistic || '')}<br><span class="quote">“${esc(pr.test.quote)}” (p. ${pr.test.page})</span></td></tr></table>` : '<p class="small muted">Not tested empirically in this paper.</p>'}`).join('')}<h4>Analytical choices (${(x.choices || []).length})</h4><table>${(x.choices || []).map((h) => `<tr><td>${esc(h.category)}</td><td>${esc(h.description)}<br><span class="quote">${esc((h.options || []).join(' | '))}</span></td><td class="small">p. ${h.page}</td></tr>`).join('')}</table><menu><button data-close class="ghost">Close</button></menu>`);
}

/* 3 PREDICTIONS */
function renderPredictions(p) {
  const list = [...F.predictions].sort((a, b) => (b.core - a.core) || (testsOf(b.id).length - testsOf(a.id).length));
  p.innerHTML = `<h2>3. Confirm the predictions and mark the core ones</h2>
  <div class="intro">A prediction is what the authors expected before the data: <strong>X → Y (direction)</strong>, at the construct level. The model proposed each one with a quote; when a later paper tests the same prediction, it was merged here and the count of studies grew. Confirm, edit, merge or reject. Mark as <strong>core</strong> the predictions that recur across studies and that later work builds on: those are the ones worth a multiverse or a replication.</div>
  ${list.length ? `<table><tr><th>Core</th><th>Prediction</th><th>Kind</th><th>Studies</th><th>Evidence</th><th>Status</th></tr>${list.map((pr) => { const ts = testsOf(pr.id); const res = ts.map((t) => t.result?.support).filter(Boolean); const sup = res.filter((r) => r === 'supported').length; return `<tr class="${pr.core ? 'core' : ''}"><td><input type="checkbox" data-core-p="${pr.id}" ${pr.core ? 'checked' : ''} title="Core prediction"></td><td><strong>${esc(pr.text)}</strong><br><span class="small">${esc(pr.statement || '')}</span><br><span class="small muted">first in ${esc(short(study(pr.study)))}${pr.builds_on?.length ? ` · builds on ${esc(pr.builds_on.join('; '))}` : ''}${pr.merge_note && pr.merge_note !== 'new' && pr.merge_note !== 'first in map' ? ` · ${esc(pr.merge_note)}` : ''}</span></td><td><span class="dim">${esc(pr.kind)}</span><br><span class="small muted">${esc(pr.direction || '')}</span></td><td>${ts.length}${res.length ? `<br><span class="small muted">${sup} supported</span>` : ''}</td><td class="quote">“${esc(pr.quote)}” (p. ${pr.page ?? '?'})</td><td>${statusBtns('prediction', pr.id, pr.status)}<br><span class="actions" style="margin-top:.3rem"><button class="small ghost" data-merge="${pr.id}">Merge into…</button></span></td></tr>`; }).join('')}</table>
  <p class="actions" style="margin-top:.6rem"><button class="small ghost" id="confirmAllP">Confirm all proposed</button><button class="small ghost" id="addP">Add prediction</button></p>` : `<div class="empty-state"><h3>No predictions yet</h3><p>Upload a PDF in step 2 and click “Import to map”.</p><button class="ghost small" onclick="location.hash='field/${F.id}/studies'">Go to step 2</button></div>`}`;
  p.addEventListener('change', (e) => { const id = e.target.dataset.coreP; if (id) { pred(id).core = e.target.checked; markDirty(); renderStep(); } });
  p.addEventListener('click', (e) => {
    const t = e.target; const { act, kind, id } = t.dataset;
    if (act && kind === 'prediction') { const item = pred(id); if (act === 'edit') return editPrediction(item); item.status = act === 'confirm' ? 'confirmed' : 'rejected'; markDirty(); return renderStep(); }
    if (t.id === 'confirmAllP') { F.predictions.filter((x) => x.status === 'ai').forEach((x) => (x.status = 'confirmed')); markDirty(); return renderStep(); }
    if (t.id === 'addP') { const np = { id: uid('p_'), study: null, sources: [], label: null, text: '', statement: '', x: '', y: '', direction: 'positive', kind: 'main', core: false, builds_on: [], quote: '', page: null, status: 'confirmed' }; F.predictions.push(np); return editPrediction(np); }
    if (t.dataset.merge) return mergeDialog(t.dataset.merge);
  });
}
function editPrediction(item) {
  modal(`<h3>Edit prediction</h3><form id="ef"><label>X → Y (direction)<input name="text" value="${esc(item.text)}" required></label><label>Plain statement<textarea name="statement">${esc(item.statement || '')}</textarea></label><div class="row"><label style="flex:1">Kind<select name="kind">${['main', 'moderation', 'mediation', 'null'].map((k) => `<option ${item.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label><label style="flex:1">Direction<select name="direction">${['positive', 'negative', 'null', 'conditional'].map((k) => `<option ${item.direction === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label></div><label>Supporting quote<textarea name="quote">${esc(item.quote || '')}</textarea></label><label>Page<input name="page" type="number" value="${item.page ?? ''}"></label><menu><button type="button" data-close class="ghost">Cancel</button><button>Save</button></menu></form>`, (b) => {
    $('#ef', b).addEventListener('submit', (e) => { e.preventDefault(); const fd = new FormData(e.target); item.text = fd.get('text'); item.statement = fd.get('statement'); item.kind = fd.get('kind'); item.direction = fd.get('direction'); item.quote = fd.get('quote'); item.page = Number(fd.get('page')) || null; if (item.status === 'ai') item.status = 'confirmed'; markDirty(); $('#modal').close(); renderStep(); });
  });
}
// Merge prediction A into B: B keeps its text; A's tests and sources move to B; A is removed.
function mergeDialog(aid) {
  const a = pred(aid); const others = F.predictions.filter((x) => x.id !== aid && x.status !== 'rejected');
  if (!others.length) return toast('Nothing to merge into yet.');
  modal(`<h3>Merge “${esc(a.text.slice(0, 80))}” into…</h3><form id="mf"><label>Target prediction<select name="to">${others.map((x) => `<option value="${x.id}">${esc(x.text.slice(0, 110))} (${testsOf(x.id).length} studies)</option>`).join('')}</select></label><p class="small muted">The target keeps its wording; this prediction's tests and source studies move to it.</p><menu><button type="button" data-close class="ghost">Cancel</button><button>Merge</button></menu></form>`, (b) => {
    $('#mf', b).addEventListener('submit', (e) => { e.preventDefault(); const to = pred(new FormData(e.target).get('to')); F.tests.forEach((t) => { if (t.prediction === aid) t.prediction = to.id; }); to.sources = [...new Set([...(to.sources || []), ...(a.sources || [])])]; to.core = to.core || a.core; F.predictions = F.predictions.filter((x) => x.id !== aid); markDirty(); $('#modal').close(); renderStep(); toast('Merged.'); });
  });
}

/* 4 DESIGN MAP */
function designRange(pid, dimId) {
  const vals = {}; for (const t of testsOf(pid)) { let v = (t.design || {})[dimId]; if (Array.isArray(v)) v = v.join(', '); if (!v) continue; const k = String(v).trim(); (vals[k] ||= []).push(t); }
  return Object.entries(vals).map(([v, ts]) => ({ value: v, tests: ts }));
}
const OPEN_TESTS = new Set();
function renderDesigns(p) {
  const core = F.predictions.filter((x) => x.status === 'confirmed' && x.core);
  const others = F.predictions.filter((x) => x.status === 'confirmed' && !x.core);
  p.innerHTML = `<h2>4. Design map: how each core prediction has been tested</h2>
  <div class="intro">For each core prediction, the rows are the nine <strong>research-design dimensions</strong> and the cells list the options used across studies, with the result each study found. A dimension with several options and mixed results is a design decision that matters: an input to a multiverse, and a candidate for the next test. Confirm or reject the tests the model extracted; edit them if the paper says otherwise.</div>
  ${core.length ? core.map((pr) => { const ts = testsOf(pr.id); const varying = DD().filter((d) => designRange(pr.id, d.id).length > 1); return `<div class="card"><div class="row" style="justify-content:space-between"><div><strong>★ ${esc(pr.text)}</strong><br><span class="small muted">${ts.length} test${ts.length === 1 ? '' : 's'} in ${new Set(ts.map((t) => t.study)).size} stud${new Set(ts.map((t) => t.study)).size === 1 ? 'y' : 'ies'} · ${ts.filter((t) => t.result?.support === 'supported').length} supported, ${ts.filter((t) => t.result?.support === 'not supported').length} not, ${ts.filter((t) => t.result?.support === 'partly').length} partly · design decisions that vary: ${varying.length ? varying.map((d) => esc(d.name)).join(', ') : 'none yet'}</span></div>${planLink(pr)}</div>
    <table style="margin-top:.6rem"><tr><th>Dimension</th><th>Options used across studies (study: result)</th></tr>${DD().map((d) => { const r = designRange(pr.id, d.id); return `<tr><td><b>${esc(d.name)}</b><br><span class="small muted">${esc(d.question)}</span></td><td class="cell ${r.length > 1 ? 'partly' : r.length ? 'covered' : 'none'}" style="text-align:left">${r.length ? r.map((o) => `<div><strong>${esc(o.value)}</strong> <span class="small muted">${o.tests.map((t) => `${esc(short(study(t.study)))}: ${esc(t.result?.direction || '?')}/${esc(t.result?.support || '?')}`).join('; ')}</span></div>`).join('') : '<span class="muted small">not reported</span>'}${r.length > 1 ? ` <div>${planLink(pr, { id: d.id, options: r.map((o) => o.value) })}</div>` : ''}</td></tr>`; }).join('')}</table>
    <details style="margin-top:.5rem" data-open="${pr.id}" ${OPEN_TESTS.has(pr.id) ? 'open' : ''}><summary>Tests of this prediction (${ts.length}) — confirm or edit</summary><table>${F.tests.filter((t) => t.prediction === pr.id).map((t) => `<tr><td><b>${esc(short(study(t.study)))}</b>${t.label ? ` ${esc(t.label)}` : ''}<br><span class="small muted">${esc(t.design?.dv_measure || '')} on ${esc(t.design?.iv_measure || '')}; ${esc(t.design?.estimator || '')}</span></td><td class="small">${esc(t.result?.direction || '')}, ${esc(t.result?.support || '')}; ${esc(t.result?.statistic || '')}<br><span class="quote">“${esc(t.result?.quote || '')}” (p. ${t.result?.page ?? '?'})</span></td><td>${statusBtns('test', t.id, t.status)}</td></tr>`).join('')}</table></details></div>`; }).join('') : `<div class="empty-state"><h3>No core predictions confirmed</h3><p>In step 3, confirm predictions and tick the core ones; the design map is built from those.</p><button class="ghost small" onclick="location.hash='field/${F.id}/predictions'">Go to step 3</button></div>`}
  ${others.length ? `<div class="card"><h3>Other confirmed predictions (${others.length})</h3><p class="small muted">Not marked core. ${others.map((x) => `${esc(x.text)} (${testsOf(x.id).length})`).join(' · ')}</p></div>` : ''}`;
  p.addEventListener('toggle', (e) => { const d = e.target; if (d.dataset?.open) { if (d.open) OPEN_TESTS.add(d.dataset.open); else OPEN_TESTS.delete(d.dataset.open); } }, true);
  p.addEventListener('click', (e) => { const { act, kind, id } = e.target.dataset; if (kind !== 'test') return; const t = F.tests.find((x) => x.id === id); if (act === 'edit') return editTest(t); t.status = act === 'confirm' ? 'confirmed' : 'rejected'; markDirty(); renderStep(); });
}
function editTest(t) {
  modal(`<h3>Edit test (${esc(short(study(t.study)))})</h3><form id="ef" style="max-height:70vh;overflow:auto">${DD().map((d) => `<label>${esc(d.name)}<input name="${d.id}" value="${esc(Array.isArray(t.design?.[d.id]) ? t.design[d.id].join('; ') : t.design?.[d.id] || '')}"></label>`).join('')}<div class="row"><label style="flex:1">Result direction<select name="direction">${['positive', 'negative', 'null', 'mixed'].map((k) => `<option ${t.result?.direction === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label><label style="flex:1">Support<select name="support">${['supported', 'not supported', 'partly'].map((k) => `<option ${t.result?.support === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label></div><label>Statistic<input name="statistic" value="${esc(t.result?.statistic || '')}"></label><menu><button type="button" data-close class="ghost">Cancel</button><button>Save</button></menu></form>`, (b) => {
    $('#ef', b).addEventListener('submit', (e) => { e.preventDefault(); const fd = new FormData(e.target); t.design = t.design || {}; for (const d of DD()) t.design[d.id] = d.id === 'controls' ? String(fd.get(d.id)).split(';').map((x) => x.trim()).filter(Boolean) : fd.get(d.id); t.result = { ...(t.result || {}), direction: fd.get('direction'), support: fd.get('support'), statistic: fd.get('statistic') }; if (t.status === 'ai') t.status = 'confirmed'; markDirty(); $('#modal').close(); renderStep(); });
  });
}

/* 5 CHOICE SPACE (D2 benchmark) */
function renderChoices(p) {
  const bySt = {}; for (const h of F.choices) (bySt[h.study] = bySt[h.study] || []).push(h);
  const ref = F.reference || [];
  const matched = new Set(F.matches.flatMap((m) => m.a || []));
  p.innerHTML = `<h2>5. Space of analytical choices</h2>
  <div class="intro">The analytical choices the model found in each paper form the <em>choice space</em> for a multiverse. For the benchmark, load or paste a reference list (the Berchicci &amp; King, 2022 window of model uncertainty is built in, one choice per line as <code>category | description</code>), then align the two lists. Found, missed and added are the benchmark result; you can override every match.</div>
  <div class="grid2"><div class="card"><h3>Reference list (${ref.length})</h3><textarea id="refText" placeholder="sample | Exclude financial firms&#10;controls | Firm size (log assets)&#10;model | Firm fixed effects vs random effects" style="min-height:140px">${esc(ref.map((r) => `${r.category} | ${r.description}`).join('\n'))}</textarea><p class="actions"><button class="small" id="saveRef">Save list</button><button class="small ghost" id="loadBench">Load Berchicci &amp; King (2022) reference</button><button class="small ghost" id="runCompare" ${ref.length && F.choices.length ? '' : 'disabled'}>Align with AI choices</button></p></div>
  <div class="card"><h3>Benchmark summary</h3>${F.matches.length ? (() => { const found = F.matches.filter((m) => m.a?.length).length; const added = F.choices.filter((h) => h.status !== 'rejected' && !matched.has(h.key + '@' + h.study)).length; return `<p><strong>${found}/${ref.length}</strong> reference choices found by the AI (${Math.round(100 * found / Math.max(1, ref.length))}%), <strong>${ref.length - found}</strong> missed, <strong>${added}</strong> additional choices proposed.</p><table><tr><th>Reference choice</th><th>Matched AI choice(s)</th><th>Conf.</th></tr>${F.matches.map((m) => { const r = ref.find((x) => x.key === m.r) || {}; return `<tr><td>[${esc(r.category)}] ${esc(r.description)}</td><td>${(m.a || []).map((k) => { const [key, sid] = k.split('@'); const h = F.choices.find((x) => x.key === key && x.study === sid); return h ? `${esc(h.description)} <span class="muted">(${esc(short(study(sid)))})</span>` : esc(k); }).join('<br>') || '<span style="color:var(--bad)">missed</span>'}${m.note ? `<br><span class="small muted">${esc(m.note)}</span>` : ''}</td><td>${esc(m.confidence || '')}</td></tr>`; }).join('')}</table>`; })() : '<p class="muted">No alignment yet.</p>'}</div></div>
  ${Object.entries(bySt).map(([sid, list]) => `<div class="card"><h3>${esc(short(study(sid)))} <span class="small muted">${esc(study(sid)?.title || '')}</span></h3><table><tr><th>Category</th><th>Choice</th><th>Options</th><th>Alt. reported</th><th>Evidence</th><th>Status</th></tr>${list.map((h) => `<tr><td>${esc(h.category)}</td><td>${esc(h.description)}${matched.has(h.key + '@' + sid) ? ' <span class="status confirmed">in reference</span>' : ''}</td><td class="small">${esc((h.options || []).join(' | '))}</td><td>${h.alternatives_reported ? 'yes' : 'no'}</td><td class="quote">“${esc(h.quote)}” (p. ${h.page ?? '?'})</td><td>${statusBtns('choice', h.id, h.status)}</td></tr>`).join('')}</table></div>`).join('') || `<div class="empty-state"><h3>No analytical choices yet</h3><p>Choices are collected when you import an extraction in step 2.</p></div>`}`;
  $('#saveRef').addEventListener('click', () => { F.reference = $('#refText').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => { const [c, ...d] = l.split('|'); return { key: `r${i + 1}`, category: (d.length ? c : 'other').trim(), description: (d.length ? d.join('|') : c).trim() }; }); markDirty(); renderStep(); });
  $('#loadBench').addEventListener('click', async () => { const b = (await api('/api/benchmarks'))[0]; $('#refText').value = b.reference.map((r) => `${r.category} | ${r.description}`).join('\n'); toast(`${b.reference.length} reference choices loaded from ${b.name.split(':')[0]}. Click Save list.`); });
  $('#runCompare').addEventListener('click', async (e) => {
    busy(e.target, true, 'Aligning…');
    try { const A = F.choices.filter((h) => h.status !== 'rejected').map((h) => ({ key: `${h.key}@${h.study}`, category: h.category, description: h.description, options: h.options })); const r = await api('/api/compare', { fieldId: F.id, reference: F.reference, choices: A }); F.matches = r.matches || []; markDirty(); renderStep(); }
    catch (err) { toast(err.message, true); busy(e.target, false); }
  });
  p.addEventListener('click', (e) => { const { act, kind, id } = e.target.dataset; if (kind !== 'choice') return; const h = F.choices.find((x) => x.id === id); if (act === 'edit') { modal(`<h3>Edit choice</h3><form id="ef"><label>Category<input name="category" value="${esc(h.category)}"></label><label>Description<textarea name="description">${esc(h.description)}</textarea></label><label>Options (one per line)<textarea name="options">${esc((h.options || []).join('\n'))}</textarea></label><menu><button type="button" data-close class="ghost">Cancel</button><button>Save</button></menu></form>`, (b) => $('#ef', b).addEventListener('submit', (ev) => { ev.preventDefault(); const fd = new FormData(ev.target); h.category = fd.get('category'); h.description = fd.get('description'); h.options = fd.get('options').split('\n').map((x) => x.trim()).filter(Boolean); if (h.status === 'ai') h.status = 'confirmed'; markDirty(); $('#modal').close(); renderStep(); })); return; } h.status = act === 'confirm' ? 'confirmed' : 'rejected'; markDirty(); renderStep(); });
}

/* 6 EXPORT */
function renderExport(p) {
  const conf = (arr) => arr.filter((x) => x.status === 'confirmed').length;
  const core = F.predictions.filter((x) => x.status === 'confirmed' && x.core);
  const decisions = []; for (const pr of core) for (const d of DD()) { const r = designRange(pr.id, d.id); if (r.length > 1) { const results = new Set(r.flatMap((o) => o.tests.map((t) => t.result?.support)).filter(Boolean)); decisions.push({ pr, d, options: r.length, mixed: results.size > 1 }); } }
  decisions.sort((a, b) => (b.mixed - a.mixed) || (b.options - a.options));
  p.innerHTML = `<h2>6. Export and next tests</h2>
  <div class="card"><h3>Status of “${esc(F.name)}”</h3><table><tr><th></th><th>Total</th><th>Confirmed</th></tr><tr><td>Studies in corpus / core / read</td><td>${F.studies.length}</td><td>${F.studies.filter((s) => s.core).length} / ${F.studies.filter((s) => s.extraction).length}</td></tr><tr><td>Predictions (core)</td><td>${F.predictions.length}</td><td>${conf(F.predictions)} (${core.length})</td></tr><tr><td>Tests (prediction × study)</td><td>${F.tests.length}</td><td>${conf(F.tests)}</td></tr><tr><td>Analytical choices</td><td>${F.choices.length}</td><td>${conf(F.choices)}</td></tr></table></div>
  <div class="card"><h3>Core predictions</h3>${core.length ? `<ol>${core.map((pr) => { const ts = testsOf(pr.id); return `<li><strong>${esc(pr.text)}</strong> <span class="small muted">— ${ts.length} test${ts.length === 1 ? '' : 's'}, ${ts.filter((t) => t.result?.support === 'supported').length} supported; first in ${esc(short(study(pr.study)))}</span> ${planLink(pr)}</li>`; }).join('')}</ol>` : '<p class="muted">None marked yet (step 3).</p>'}</div>
  <div class="card"><h3>Design decisions that matter most</h3><p class="small muted">Dimensions where studies made different choices, ranked with mixed results first. These are the inputs to a multiverse and the first candidates for the next test.</p>${decisions.length ? `<ol>${decisions.slice(0, 12).map((x) => `<li><strong>${esc(x.d.name)}</strong> for “${esc(x.pr.text)}”: ${x.options} options${x.mixed ? ', <span style="color:var(--warn)">mixed results</span>' : ', consistent results'} ${planLink(x.pr, { id: x.d.id, options: designRange(x.pr.id, x.d.id).map((o) => o.value) })}</li>`).join('')}</ol>` : '<p class="muted">Nothing varies yet: import more studies that test the same prediction.</p>'}${CFG.navigatorUrl ? '' : '<p class="small muted">Set NAVIGATOR_URL on the server to add “Plan this test” links that open Replication Navigator with the prediction and design options pre-filled.</p>'}</div>
  <div class="card"><h3>Downloads</h3><p class="actions"><a href="/api/fields/${F.id}/export.json"><button>Field as JSON</button></a><a href="/api/fields/${F.id}/designs.csv"><button class="ghost">Design table (CSV)</button></a></p><p class="small muted">The JSON holds everything and can be re-imported. The CSV is one row per prediction × study with the nine design dimensions and the result, for R or Python.</p></div>
  <div class="card"><h3>Notes</h3><textarea id="notes" style="min-height:120px" placeholder="Coding decisions, who confirmed what, open questions…">${esc(F.notes || '')}</textarea></div>`;
  $('#notes').addEventListener('input', (e) => { F.notes = e.target.value; markDirty(); });
}

// ---------- boot ----------
(async () => { CFG = await api('/api/config'); const d = $('#dbState'); d.hidden = false; d.textContent = CFG.store === 'postgres' ? 'Database connected' : 'File storage'; d.classList.toggle('files', CFG.store !== 'postgres'); route(); })();

// ================= AI coach =================
const STARTERS = {
  corpus: ['How do I bound this field?', 'Which studies should be core: seminal, recent or rising?', 'Should reviews be in the corpus?'],
  studies: ['What should I check in an extraction before importing it?', 'The paper has no hypotheses; what is its prediction?'],
  predictions: ['Are these two predictions the same?', 'Which predictions here are core?', 'Is this a prediction or a finding?'],
  designs: ['Which design decision matters most for this prediction?', 'Do the mixed results come from the design or the sample?', 'What is missing from the design range?'],
  choices: ['Which choices form a reasonable multiverse?', 'How do I judge a missed vs an added choice?'],
  export: ['What is the most informative next test?', 'Draft a one-paragraph justification for the next test', 'How should I report the design map?']
};
const CHAT = {}; // step -> messages[]
let CARDS = null, streaming = false;
const SESSION = (() => { try { let s = sessionStorage.getItem('cm.sid'); if (!s) { s = uid('cm_'); sessionStorage.setItem('cm.sid', s); } return s; } catch { return uid('cm_'); } })();
async function cardsIndex() { if (CARDS) return CARDS; const k = await api('/api/knowledge'); CARDS = { byId: new Map(k.cards.map((c) => [c.id, c])), src: new Map(k.sources.map((s) => [s.key, s])) }; return CARDS; }
function mdLite(text) {
  const lines = esc(text).split('\n'); let out = '', inList = false;
  for (const l of lines) {
    const li = /^\s*[-•*]\s+(.*)/.exec(l);
    if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${li[1]}</li>`; continue; }
    if (inList) { out += '</ul>'; inList = false; }
    if (l.trim()) out += `<p>${l}</p>`;
  }
  if (inList) out += '</ul>';
  return out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([a-z]+\d{4}-\d{2,3})\]/g, (m, id) => `<a class="cite" data-card="${id}">${id}</a>`);
}
function renderChat() {
  const box = $('#chat'); const msgs = CHAT[STEP] || [];
  box.innerHTML = msgs.length ? msgs.map((m, i) => m.role === 'user' ? `<div class="msg user">${esc(m.content)}</div>` : `<div class="msg bot ${m.error ? 'err' : ''}" data-i="${i}">${m.error ? esc(m.error) : mdLite(m.content)}${m.done ? `<div class="meta">${m.citations?.some((c) => !c.valid) ? '<span style="color:var(--bad)">Some citations do not exist in the evidence base.</span>' : ''}${m.stop === 'max_tokens' ? '<button class="small ghost" data-cont="1">Continue</button>' : ''}<button class="small ghost" data-flag="' + i + '" title="Flag a citation that does not support the claim">Flag</button></div>` : ''}</div>`).join('') : `<div class="msg bot">Hi. I can see this field's studies, predictions and the designs used to test them. Ask me about this step, or pick a question above.</div>`;
  box.querySelectorAll('.cite').forEach((el) => { if (CARDS && !CARDS.byId.has(el.dataset.card)) el.classList.add('bad'); });
  box.scrollTop = box.scrollHeight;
}
function renderStarters() { $('#starters').innerHTML = (STARTERS[STEP] || []).map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join(''); $('#coachStep').textContent = `Step ${{ corpus: 1, studies: 2, predictions: 3, designs: 4, choices: 5, export: 6 }[STEP] || 1} · grounded in 322 evidence cards`; }
async function ask(text, cont = false) {
  if (streaming || !F) return;
  const msgs = (CHAT[STEP] ||= []);
  if (cont) msgs.push({ role: 'user', content: 'Please continue from where you stopped.' }); else msgs.push({ role: 'user', content: text });
  const bot = { role: 'assistant', content: '', done: false }; msgs.push(bot); renderChat(); streaming = true; busy($('#coachSend'), true, '…');
  const live = $('#chat .msg.bot:last-child'); live && live.classList.add('typing');
  try {
    const r = await fetch('/api/coach', { method: 'POST', headers: headers(), body: JSON.stringify({ fieldId: F.id, step: STEP, sessionId: SESSION, messages: msgs.filter((m) => m !== bot).map((m) => ({ role: m.role, content: m.content })) }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Request failed (${r.status})`); }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    while (true) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) { if (!l.trim()) continue; const ev = JSON.parse(l);
        if (ev.type === 'delta') { bot.content += ev.text; const el = $('#chat .msg.bot:last-child'); if (el) { el.innerHTML = mdLite(bot.content); el.classList.add('typing'); $('#chat').scrollTop = $('#chat').scrollHeight; } }
        else if (ev.type === 'done') { bot.done = true; bot.citations = ev.citations; bot.stop = ev.stop; }
        else if (ev.type === 'error') { bot.error = ev.error; bot.done = true; } } }
    if (!bot.done) bot.done = true;
  } catch (e) { bot.error = e.message; bot.done = true; }
  finally { streaming = false; busy($('#coachSend'), false); await cardsIndex().catch(() => null); renderChat(); }
}
async function showCard(id) {
  const k = await cardsIndex(); const c = k.byId.get(id);
  if (!c) return modal(`<div class="card-view"><h4>${esc(id)}</h4><p style="color:var(--bad)">This card id does not exist in the evidence base. The coach should not have cited it; please flag the reply.</p><menu><button data-close class="ghost">Close</button></menu></div>`);
  const src = k.src.get(c.source) || {};
  modal(`<div class="card-view"><span class="dim">${esc(c.stage)} · ${esc(c.kind)}</span><h4>${esc(c.title)} <span class="muted small">[${esc(c.id)}]</span></h4><p>${esc(c.guidance)}</p><p><strong>Action:</strong> ${esc(c.action)}</p><span class="quote">“${esc(c.quote)}” (${esc(src.short || c.source)}, p. ${c.printed_page ?? c.pdf_page})</span><p class="small muted">${esc(src.citation || '')}${src.url ? ` · <a href="${esc(src.url)}" target="_blank" rel="noopener">source</a>` : ''}</p><menu><button data-close class="ghost">Close</button></menu></div>`);
}
$('#coachForm').addEventListener('submit', (e) => { e.preventDefault(); const t = $('#coachInput').value.trim(); if (!t) return; $('#coachInput').value = ''; ask(t); });
$('#coachInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#coachForm').requestSubmit(); } });
$('#starters').addEventListener('click', (e) => { const q = e.target.dataset.q; if (q) ask(q); });
$('#chat').addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.card) return showCard(t.dataset.card);
  if (t.dataset.cont) return ask('', true);
  if (t.dataset.flag !== undefined) { const m = (CHAT[STEP] || [])[Number(t.dataset.flag)]; const ids = (m?.citations || []).map((c) => c.id); const id = prompt(`Which citation does not support the claim?${ids.length ? `\n${ids.join(', ')}` : ''}`, ids[0] || ''); if (!id) return; await api('/api/flag', { fieldId: F.id, cardId: id, step: STEP }); toast('Thanks, flagged for review.'); }
});
$('#coachOpen').addEventListener('click', () => $('#coach').classList.add('open'));
$('#coachClose').addEventListener('click', () => $('#coach').classList.remove('open'));
