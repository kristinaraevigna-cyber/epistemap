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
async function api(path, body, method) {
  const r = await fetch(path, { method: method || (body ? 'POST' : 'GET'), headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), err ? 6000 : 2500); }
function busy(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; } else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; } }

// ---------- persistence ----------
function markDirty() { const e = $('#saveState'); e.textContent = 'Saving…'; e.className = 'save-state dirty'; clearTimeout(saveTimer); saveTimer = setTimeout(save, 800); updateCounts(); }
async function save() {
  if (!F) return;
  try { const { version } = await api(`/api/fields/${F.id}`, { doc: F, version: VERSION }, 'PUT'); VERSION = version; $('#saveState').textContent = 'Saved'; $('#saveState').className = 'save-state'; }
  catch (e) { $('#saveState').textContent = 'Not saved'; $('#saveState').className = 'save-state err'; toast(e.message, true); }
}
window.addEventListener('pagehide', () => { if (saveTimer) { clearTimeout(saveTimer); navigator.sendBeacon && save(); } });

// ---------- routing ----------
async function route() {
  const h = location.hash.replace(/^#/, '');
  const m = /^field\/([^/]+)(?:\/(\w+))?/.exec(h);
  if (!m) { F = null; $('#work').hidden = true; $('#home').hidden = false; $('#fieldName').hidden = true; return renderHome(); }
  if (!F || F.id !== m[1]) { F = await api(`/api/fields/${m[1]}`); VERSION = F.version || 1; }
  STEP = m[2] || 'corpus';
  $('#home').hidden = true; $('#work').hidden = false; $('#fieldName').textContent = F.name; $('#fieldName').hidden = false;
  document.querySelectorAll('#steps li').forEach((li) => li.classList.toggle('active', li.dataset.step === STEP));
  updateCounts(); renderStep(); $('#panel').scrollTop = 0; window.scrollTo(0, 0);
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
  set('c-claims', F.claims.length ? `${conf(F.claims)}/${F.claims.length} confirmed` : 'nothing to review', conf(F.claims));
  set('c-coverage', F.coverage.length ? `${conf(F.coverage)}/${F.coverage.length} tags confirmed` : 'no tags yet', conf(F.coverage));
  set('c-choices', F.choices.length ? `${F.choices.length} choices${F.matches.length ? ' · aligned' : ''}` : 'no choices yet', F.matches.length);
  set('c-export', '', false);
}

// ---------- home ----------
async function renderHome() {
  const list = await api('/api/fields');
  $('#fieldCount').textContent = list.length ? `${list.length} field${list.length > 1 ? 's' : ''}` : ''; $('#fieldList').innerHTML = list.length ? list.map((f) => `<li><a href="#field/${f.id}">${esc(f.name)}</a><span class="muted small">${f.studies} studies · ${f.claims} claims · ${new Date(f.updated).toLocaleDateString()}</span></li>`).join('') : '<li class="empty">No fields yet. Name one above to start.</li>';
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
function planLink(a) {
  if (!CFG.navigatorUrl) return '';
  const c = claim(a.claim); const s = c ? study(c.study) : null;
  const citation = s ? [s.authors, s.year ? `(${s.year})` : '', s.title, s.venue, s.doi ? `https://doi.org/${s.doi}` : ''].filter(Boolean).join('. ') : '';
  const st = cellState(a.id);
  const coverage = st.rows.filter((v) => v.varied !== 'no').map((v) => `${short(study(v.study))}: ${v.varied}${v.how ? ', ' + v.how : ''}`).join('; ') || 'No study in the map has varied this assumption yet.';
  const plan = { field: F.name, claimId: c?.id, assumptionId: a.id, citation, claim: c?.text, dimension: dimName(a.dimension), assumption: a.text, coverage };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(plan)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `<a class="plan-link" href="${CFG.navigatorUrl}/?plan=${b64}" target="_blank" rel="noopener" title="Open Replication Navigator with this claim and assumption pre-filled">Plan this test →</a>`;
}

// ---------- steps ----------
function renderStep() {
  const p = $('#panel');
  ({ corpus: renderCorpus, studies: renderStudies, claims: renderClaims, coverage: renderCoverage, choices: renderChoices, export: renderExport }[STEP] || renderCorpus)(p);
}

/* 1 CORPUS */
function renderCorpus(p) {
  const core = F.studies.filter((s) => s.core).length;
  p.innerHTML = `
  <h2>1. Define the field and its core studies</h2>
  <div class="intro">Build a corpus of candidate studies, then mark the <strong>core</strong> ones: the studies whose claims the map will cover. Use OpenAlex (open, no account) or upload an export from Web of Science or Scopus (the same files bibliometrix reads). <em>Local citations</em> count how often each paper is cited by other papers in the corpus; high local citations are a good signal of a core study.</div>
  <div class="grid2">
    <div class="card"><h3>Search OpenAlex</h3>
      <form id="oa"><label>Query<input name="q" placeholder='e.g. "corporate social performance" "financial performance"' required></label>
      <div class="row"><label style="flex:1">From year<input name="from" type="number" placeholder="1990"></label><label style="flex:1">To year<input name="to" type="number" placeholder="2026"></label><label style="flex:1">Results<input name="n" type="number" value="50" min="5" max="200"></label></div>
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
  <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Corpus: ${F.studies.length} studies, ${core} core</h3><span class="actions"><button class="small ghost" id="localCites">Compute local citations</button><button class="small ghost" id="sortCites">Sort by citations</button></span></div>
  ${F.studies.length ? `<table><tr><th>Core</th><th>Study</th><th>Year</th><th>Venue</th><th>Cited by</th><th>Local</th><th></th></tr>${F.studies.map((s) => `<tr class="${s.core ? 'core' : ''}"><td><input type="checkbox" data-core="${s.id}" ${s.core ? 'checked' : ''}></td><td><strong>${esc(s.title)}</strong><br><span class="muted small">${esc(s.authors)}${s.doi ? ` · <a href="https://doi.org/${esc(s.doi)}" target="_blank">doi</a>` : ''}</span>${s.abstract ? `<details><summary class="small">abstract</summary><span class="small">${esc(s.abstract)}</span></details>` : ''}</td><td>${s.year || ''}</td><td class="small">${esc(s.venue)}</td><td>${s.cited_by ?? ''}</td><td>${s.local_cites || 0}</td><td><button class="small ghost" data-rm="${s.id}">×</button></td></tr>`).join('')}</table>` : '<div class="empty-state"><h3>Corpus is empty</h3><p>Search OpenAlex, upload an export, or add a study by hand.</p></div>'}</div>`;
  $('#oa').addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(e.target); const btn = e.target.querySelector('button'); busy(btn, true, 'Searching…');
    try { const r = await api('/api/openalex/search', { query: fd.get('q'), fromYear: fd.get('from') || null, toYear: fd.get('to') || null, perPage: Number(fd.get('n')) || 50 }); showCandidates($('#oaOut'), r.results, `${r.total.toLocaleString()} matches in OpenAlex; showing the ${r.results.length} most cited.`); }
    catch (err) { toast(err.message, true); } finally { busy(btn, false); }
  });
  $('#expFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const text = await f.text(); const r = await fetch('/api/corpus/parse', { method: 'POST', headers: { ...headers(), 'content-type': 'text/plain', 'x-filename': f.name }, body: text }); const j = await r.json(); if (!r.ok) throw new Error(j.error); showCandidates($('#expOut'), j.studies, `${j.studies.length} records read from ${esc(f.name)}.`); }
    catch (err) { toast(err.message, true); }
  });
  $('#manual').addEventListener('submit', (e) => { e.preventDefault(); const fd = new FormData(e.target); F.studies.push({ id: uid('s_'), doi: fd.get('doi') || null, title: fd.get('title'), authors: fd.get('authors'), year: Number(fd.get('year')) || null, venue: '', cited_by: null, local_cites: 0, references: [], source: 'manual', abstract: '', core: true, status: 'core', extraction: null, added: new Date().toISOString() }); markDirty(); renderCorpus(p); });
  p.addEventListener('change', (e) => { const id = e.target.dataset.core; if (id) { const s = study(id); s.core = e.target.checked; s.status = s.core ? 'core' : 'candidate'; markDirty(); renderCorpus(p); } });
  p.addEventListener('click', async (e) => {
    if (e.target.dataset.rm) { F.studies = F.studies.filter((s) => s.id !== e.target.dataset.rm); markDirty(); return renderCorpus(p); }
    if (e.target.id === 'localCites') { const r = await api('/api/corpus/local-cites', { studies: F.studies }); F.studies = r.studies; markDirty(); renderCorpus(p); toast('Local citations computed (needs OpenAlex ids to find links).'); }
    if (e.target.id === 'sortCites') { F.studies.sort((a, b) => (b.local_cites - a.local_cites) || ((b.cited_by || 0) - (a.cited_by || 0))); markDirty(); renderCorpus(p); }
  });
}
function showCandidates(el, list, note) {
  el._list = list;
  el.innerHTML = `<p>${note} <button class="small" id="addAll">Add all to corpus</button> <button class="small ghost" id="addSel">Add selected</button></p><div style="max-height:320px;overflow:auto"><table>${list.map((s, i) => `<tr><td><input type="checkbox" data-i="${i}"></td><td>${esc(s.title)}<br><span class="muted">${esc(s.authors)} · ${s.year || ''} · ${esc(s.venue)}</span></td><td>${s.cited_by ?? ''}</td></tr>`).join('')}</table></div>`;
  el.onclick = async (e) => {
    let pick = null;
    if (e.target.id === 'addAll') pick = list;
    if (e.target.id === 'addSel') pick = [...el.querySelectorAll('input:checked')].map((c) => list[c.dataset.i]);
    if (!pick) return;
    const r = await api('/api/corpus/merge', { existing: F.studies, incoming: pick }); F.studies = r.studies; markDirty(); toast(`${r.added} added`); renderCorpus($('#panel'));
  };
}

/* 2 STUDIES: upload PDFs and extract */
function renderStudies(p) {
  const list = F.studies.filter((s) => s.core);
  p.innerHTML = `<h2>2. Read the core studies</h2>
  <div class="intro">Upload the PDF of each core study. The model extracts the paper's claims, the assumptions behind each claim (in five dimensions), and its analytical choices, each with a verbatim quote and page number. Nothing is accepted until you confirm it in step 3. PDFs are read once and not stored; keep this tab open if you want to reuse a PDF for tagging in step 4.</div>
  <div class="card"><h3>Add a study directly from a PDF</h3><p class="small muted">If the paper is not in the corpus yet, drop it here: the citation is taken from the paper.</p><div class="drop" id="dropNew">Drop a PDF here or <label style="display:inline;color:var(--accent);cursor:pointer"><u>choose a file</u><input type="file" accept="application/pdf" id="fileNew" hidden></label></div><div id="newOut"></div></div>
  ${list.length ? `<table><tr><th>Core study</th><th>Extraction</th><th></th></tr>${list.map((s) => `<tr><td><strong>${esc(s.title)}</strong><br><span class="muted small">${esc(s.authors)} · ${s.year || ''}</span></td><td class="small">${s.extraction ? `${s.extraction.claims.length} claims · ${s.extraction.claims.reduce((n, c) => n + c.assumptions.length, 0)} assumptions · ${s.extraction.choices.length} choices${s.imported ? ' · <span class="status confirmed">imported</span>' : ''}<br><span class="muted">${esc(s.extraction.summary)}</span>` : '<span class="muted">not read yet</span>'}${PDF[s.id] ? '<br><span class="muted">PDF in memory</span>' : ''}</td><td><label><button class="small" onclick="this.nextElementSibling.click()">${s.extraction ? 'Re-read PDF' : 'Upload PDF'}</button><input type="file" accept="application/pdf" hidden data-extract="${s.id}"></label>${s.extraction && !s.imported ? `<button class="small" data-import="${s.id}">Import to claims</button>` : ''}${s.extraction ? `<button class="small ghost" data-view="${s.id}">View</button>` : ''}</td></tr>`).join('')}</table>` : `<div class="empty-state"><h3>No core studies yet</h3><p>Mark studies as core in step 1, or drop a PDF above to add one directly.</p><button class="ghost small" onclick="location.hash='field/${F.id}/corpus'">Go to step 1</button></div>`}`;
  const dz = $('#dropNew');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); }); dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) extractFile(f, null, $('#newOut')); });
  $('#fileNew').addEventListener('change', (e) => { if (e.target.files[0]) extractFile(e.target.files[0], null, $('#newOut')); });
  p.addEventListener('change', (e) => { if (e.target.dataset.extract && e.target.files[0]) extractFile(e.target.files[0], e.target.dataset.extract, e.target.closest('td')); });
  p.addEventListener('click', (e) => {
    if (e.target.dataset.import) { importExtraction(e.target.dataset.import); renderStudies(p); toast('Imported. Review them in step 3.'); }
    if (e.target.dataset.view) viewExtraction(study(e.target.dataset.view));
  });
}
async function extractFile(file, studyId, out) {
  out.innerHTML = `<div class="progress"><i style="width:30%"></i></div><span class="small muted">Reading ${esc(file.name)} with the model (30–90 s)…</span>`;
  try {
    const b64 = await readPdf(file);
    const r = await api('/api/extract', { pdfBase64: b64, fieldId: F.id, studyId });
    let s = studyId ? study(studyId) : null;
    if (!s) { s = { id: uid('s_'), doi: null, title: r.extraction.citation || file.name, authors: authorsOf(r.extraction.citation), year: Number(/\((\d{4})\)/.exec(r.extraction.citation || '')?.[1]) || null, venue: '', cited_by: null, local_cites: 0, references: [], source: 'pdf', abstract: '', core: true, status: 'core', extraction: null, added: new Date().toISOString() }; F.studies.push(s); }
    s.extraction = r.extraction; s.imported = false; s.extracted_with = r.model; PDF[s.id] = b64;
    if (r.stop === 'max_tokens') toast('The extraction was cut off (very long paper). Check the last items.', true);
    markDirty(); renderStudies($('#panel')); toast('Extracted. Review, then import to claims.');
  } catch (e) { out.innerHTML = `<span class="small" style="color:var(--bad)">${esc(e.message)}</span>`; }
}
function importExtraction(sid) {
  const s = study(sid); const x = s.extraction; if (!x || s.imported) return;
  for (const c of x.claims) {
    const cid = uid('c_');
    F.claims.push({ id: cid, study: sid, text: c.text, main: !!c.main, effect: c.effect || null, quote: c.quote || '', page: c.page || null, status: 'ai' });
    for (const a of c.assumptions || []) {
      const aid = uid('a_');
      F.assumptions.push({ id: aid, claim: cid, dimension: a.dimension, text: a.text, consequential: Number(a.consequential) || 2, quote: a.quote || '', page: a.page || null, status: 'ai' });
      // the original study's own treatment of the assumption becomes the first coverage row
      F.coverage.push({ id: uid('v_'), assumption: aid, study: sid, varied: a.varied || 'no', how: a.how || null, result: 'na', quote: a.quote || '', page: a.page || null, status: 'ai', origin: 'original' });
    }
  }
  for (const ch of x.choices || []) F.choices.push({ id: uid('h_'), study: sid, key: ch.key, category: ch.category, description: ch.description, options: ch.options || [], alternatives_reported: !!ch.alternatives_reported, quote: ch.quote || '', page: ch.page || null, status: 'ai' });
  s.imported = true; markDirty();
}
function viewExtraction(s) {
  const x = s.extraction;
  modal(`<h3>${esc(x.citation)}</h3><p>${esc(x.summary)}</p><p class="small muted">Data: ${esc(x.data_source)}</p>${x.claims.map((c) => `<h4>${c.main ? '★ ' : ''}${esc(c.text)}</h4><p class="quote">“${esc(c.quote)}” (p. ${c.page})</p><table>${c.assumptions.map((a) => `<tr><td><span class="dim ${a.dimension}">${esc(dimName(a.dimension))}</span></td><td>${esc(a.text)}<br><span class="quote">“${esc(a.quote)}” (p. ${a.page})</span></td><td>c=${a.consequential}<br>varied: ${a.varied}</td></tr>`).join('')}</table>`).join('')}<h4>Analytical choices (${x.choices.length})</h4><table>${x.choices.map((h) => `<tr><td>${esc(h.category)}</td><td>${esc(h.description)}<br><span class="quote">${esc((h.options || []).join(' | '))}</span></td><td class="small">p. ${h.page}</td></tr>`).join('')}</table><menu><button data-close class="ghost">Close</button></menu>`);
}

/* 3 CLAIMS & ASSUMPTIONS */
function renderClaims(p) {
  p.innerHTML = `<h2>3. Confirm claims and their assumptions</h2>
  <div class="intro">Each claim and assumption was proposed by the model with a quote you can check. Confirm, edit or reject each one. Only confirmed items appear in the coverage map. <em>Consequential</em> (1–3) says how much the claim's interpretation would change if the assumption failed; this drives prioritisation.</div>
  ${F.claims.length ? F.claims.map((c) => { const s = study(c.study); const as = F.assumptions.filter((a) => a.claim === c.id); return `<div class="card"><div class="row" style="justify-content:space-between"><div><strong>${c.main ? '★ ' : ''}${esc(c.text)}</strong><br><span class="small muted">${esc(short(s))}${c.effect ? ` · ${esc(c.effect)}` : ''}</span><br><span class="quote">“${esc(c.quote)}” (p. ${c.page ?? '?'})</span></div>${statusBtns('claim', c.id, c.status)}</div>
    <table style="margin-top:.6rem"><tr><th>Dimension</th><th>Assumption</th><th>C</th><th>Evidence</th><th>Status</th></tr>${as.map((a) => `<tr><td><span class="dim ${a.dimension}">${esc(dimName(a.dimension))}</span></td><td>${esc(a.text)}</td><td>${a.consequential}</td><td class="quote">“${esc(a.quote)}” (p. ${a.page ?? '?'})</td><td>${statusBtns('assumption', a.id, a.status)}</td></tr>`).join('')}</table>
    <p class="actions" style="margin:.5rem 0 0"><button class="small ghost" data-add-a="${c.id}">Add assumption</button><button class="small ghost" data-confirm-all="${c.id}">Confirm all</button><button class="small danger" data-del-c="${c.id}">Delete claim</button></p></div>`; }).join('') : `<div class="empty-state"><h3>Nothing to review yet</h3><p>Upload a PDF in step 2 and click “Import to claims”.</p><button class="ghost small" onclick="location.hash='field/${F.id}/studies'">Go to step 2</button></div>`}`;
  p.addEventListener('click', (e) => {
    const t = e.target; const { act, kind, id } = t.dataset;
    if (act) { const item = kind === 'claim' ? claim(id) : F.assumptions.find((a) => a.id === id); if (act === 'edit') return editItem(kind, item); item.status = act === 'confirm' ? 'confirmed' : 'rejected'; markDirty(); return renderClaims(p); }
    if (t.dataset.confirmAll) { const cid = t.dataset.confirmAll; claim(cid).status = 'confirmed'; F.assumptions.filter((a) => a.claim === cid && a.status === 'ai').forEach((a) => (a.status = 'confirmed')); markDirty(); return renderClaims(p); }
    if (t.dataset.delC) { const cid = t.dataset.delC; if (!confirm('Delete this claim and its assumptions?')) return; F.claims = F.claims.filter((c) => c.id !== cid); const aids = new Set(F.assumptions.filter((a) => a.claim === cid).map((a) => a.id)); F.assumptions = F.assumptions.filter((a) => a.claim !== cid); F.coverage = F.coverage.filter((v) => !aids.has(v.assumption)); markDirty(); return renderClaims(p); }
    if (t.dataset.addA) { const a = { id: uid('a_'), claim: t.dataset.addA, dimension: 'design', text: '', consequential: 2, quote: '', page: null, status: 'confirmed' }; F.assumptions.push(a); editItem('assumption', a); }
  });
}
function editItem(kind, item) {
  const dims = DIM().map((d) => `<option value="${d.id}" ${item.dimension === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  modal(`<h3>Edit ${kind}</h3><form id="ef"><label>Text<textarea name="text" required>${esc(item.text)}</textarea></label>${kind === 'assumption' ? `<div class="row"><label style="flex:1">Dimension<select name="dimension">${dims}</select></label><label style="width:120px">Consequential (1–3)<input name="consequential" type="number" min="1" max="3" value="${item.consequential}"></label></div>` : `<label>Effect as reported<input name="effect" value="${esc(item.effect || '')}"></label>`}<label>Supporting quote<textarea name="quote">${esc(item.quote || '')}</textarea></label><label>Page<input name="page" type="number" value="${item.page ?? ''}"></label><menu><button type="button" data-close class="ghost">Cancel</button><button>Save</button></menu></form>`, (b) => {
    $('#ef', b).addEventListener('submit', (e) => { e.preventDefault(); const fd = new FormData(e.target); item.text = fd.get('text'); item.quote = fd.get('quote'); item.page = Number(fd.get('page')) || null; if (kind === 'assumption') { item.dimension = fd.get('dimension'); item.consequential = Number(fd.get('consequential')) || 2; } else item.effect = fd.get('effect'); if (item.status === 'ai') item.status = 'confirmed'; markDirty(); $('#modal').close(); renderStep(); });
  });
}

/* 4 COVERAGE MAP */
function cellState(aid) {
  const rows = F.coverage.filter((v) => v.assumption === aid && v.status !== 'rejected');
  const varied = rows.filter((v) => v.varied === 'yes'), partly = rows.filter((v) => v.varied === 'partly');
  return { n: varied.length, p: partly.length, rows, cls: varied.length ? 'covered' : partly.length ? 'partly' : 'none' };
}
function renderCoverage(p) {
  const claims = F.claims.filter((c) => c.status === 'confirmed');
  const tagOptions = claims.map((c) => `<option value="${c.id}">${esc(c.text.slice(0, 90))}</option>`).join('');
  const studiesWithPdf = F.studies.filter((s) => PDF[s.id]);
  p.innerHTML = `<h2>4. Coverage map</h2>
  <div class="intro">Rows are confirmed assumptions; the cell shows how many studies <strong>varied</strong> that assumption (green), only partly (amber) or none (red). Red cells with high consequentiality are where the next test is most informative. To add evidence, tag a study: the model reads its PDF against a claim's assumptions and proposes which ones it varied; you confirm.</div>
  <div class="card"><h3>Tag a study against a claim</h3>${claims.length ? `<form id="tagForm" class="row"><select name="claim" style="flex:2">${tagOptions}</select><select name="study" style="flex:1"><option value="">Upload a new PDF…</option>${studiesWithPdf.map((s) => `<option value="${s.id}">${esc(short(s))} (PDF in memory)</option>`).join('')}</select><label style="margin:0"><button type="button" class="small ghost" onclick="this.nextElementSibling.click()">Choose PDF</button><input type="file" accept="application/pdf" name="pdf" hidden></label><button class="small">Tag</button></form><div id="tagOut" class="small"></div>` : `<div class="empty-state"><h3>No confirmed claims</h3><p>Confirm at least one claim in step 3; the map is built from confirmed items only.</p><button class="ghost small" onclick="location.hash='field/${F.id}/claims'">Go to step 3</button></div>`}</div>
  <div class="legend small"><span class="cell covered">varied by ≥1 study</span><span class="cell partly">partly</span><span class="cell none">not varied</span></div>
  ${claims.map((c) => { const as = F.assumptions.filter((a) => a.claim === c.id && a.status === 'confirmed'); const byDim = DIM().map((d) => { const list = as.filter((a) => a.dimension === d.id); const cov = list.filter((a) => cellState(a.id).n).length; return `<td class="cell ${!list.length ? '' : cov === list.length ? 'covered' : cov ? 'partly' : 'none'}">${list.length ? `${cov}/${list.length}` : '—'}<small>${esc(d.name)}</small></td>`; }).join('');
    return `<div class="card"><strong>${esc(c.text)}</strong> <span class="small muted">(${esc(short(study(c.study)))})</span><table class="matrix" style="margin:.5rem 0"><tr>${byDim}</tr></table>
    <table><tr><th>Dimension</th><th>Assumption</th><th>C</th><th>Varied by</th></tr>${as.sort((a, b) => b.consequential - a.consequential).map((a) => { const st = cellState(a.id); return `<tr><td><span class="dim ${a.dimension}">${esc(dimName(a.dimension))}</span></td><td>${esc(a.text)}</td><td>${a.consequential}</td><td class="cell ${st.cls}" style="text-align:left">${st.rows.filter((v) => v.varied !== 'no').map((v) => `<div>${esc(short(study(v.study)))}${v.origin === 'original' ? ' (original)' : ''}: <em>${v.varied}</em>${v.result && v.result !== 'na' ? `, ${v.result}` : ''}${v.how ? ` — ${esc(v.how)}` : ''} <span class="status ${v.status}">${v.status}</span>${v.status === 'ai' ? ` <button class="small" data-vc="${v.id}">✓</button><button class="small ghost" data-vr="${v.id}">✗</button>` : ''}${v.quote ? `<br><span class="quote">“${esc(v.quote)}” (p. ${v.page ?? '?'})</span>` : ''}</div>`).join('') || '<span class="muted small">no study has varied this</span>'}${st.cls === 'none' ? ` <div>${planLink(a)}</div>` : ''}</td></tr>`; }).join('')}</table></div>`; }).join('')}`;
  const tf = $('#tagForm');
  tf && tf.addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(tf); const cid = fd.get('claim'); let sid = fd.get('study'); const file = fd.get('pdf'); const btn = tf.querySelector('button[type=submit], button:not([type])'); const out = $('#tagOut');
    try {
      let b64 = sid ? PDF[sid] : null;
      if (!b64) { if (!file || !file.size) throw new Error('Choose a PDF or a study with its PDF in memory'); b64 = await readPdf(file); }
      busy(btn, true, 'Reading…'); out.textContent = 'The model is reading the paper against the assumptions (30–60 s)…';
      const c = claim(cid); const as = F.assumptions.filter((a) => a.claim === cid && a.status === 'confirmed');
      const r = await api('/api/tag', { pdfBase64: b64, fieldId: F.id, studyId: sid || null, claim: { id: c.id, text: c.text, study: short(study(c.study)) }, assumptions: as });
      if (!sid) { const s = { id: uid('s_'), doi: null, title: r.citation || file.name, authors: authorsOf(r.citation), year: Number(/\((\d{4})\)/.exec(r.citation || '')?.[1]) || null, venue: '', cited_by: null, local_cites: 0, references: [], source: 'pdf', abstract: '', core: false, status: 'replication', extraction: null, added: new Date().toISOString() }; F.studies.push(s); sid = s.id; PDF[sid] = b64; }
      let n = 0;
      for (const t of r.tags) { if (!as.find((a) => a.id === t.assumption)) continue; F.coverage = F.coverage.filter((v) => !(v.assumption === t.assumption && v.study === sid)); F.coverage.push({ id: uid('v_'), assumption: t.assumption, study: sid, varied: t.varied || 'no', how: t.how || null, result: t.result || 'na', quote: t.quote || '', page: t.page || null, status: 'ai', origin: 'tag' }); if (t.varied !== 'no') n++; }
      markDirty(); renderCoverage(p); toast(`${n} assumptions varied by this study (proposed). Confirm them.`);
    } catch (err) { out.innerHTML = `<span style="color:var(--bad)">${esc(err.message)}</span>`; busy(btn, false); }
  });
  p.addEventListener('click', (e) => { const v = F.coverage.find((x) => x.id === (e.target.dataset.vc || e.target.dataset.vr)); if (!v) return; v.status = e.target.dataset.vc ? 'confirmed' : 'rejected'; markDirty(); renderCoverage(p); });
}

/* 5 CHOICE SPACE (D2 benchmark) */
function renderChoices(p) {
  const bySt = {}; for (const h of F.choices) (bySt[h.study] = bySt[h.study] || []).push(h);
  const ref = F.reference || [];
  const matched = new Set(F.matches.flatMap((m) => m.a || []));
  p.innerHTML = `<h2>5. Space of analytical choices</h2>
  <div class="intro">The analytical choices the model found in each paper form the <em>choice space</em> for a multiverse. For the benchmark, paste a reference list of choices (for example the choices mapped by Berchicci &amp; King, 2022, one per line as <code>category | description</code>), then align the two lists. Found, missed and added are the benchmark result; you can override every match.</div>
  <div class="grid2"><div class="card"><h3>Reference list (${ref.length})</h3><textarea id="refText" placeholder="sample | Exclude financial firms&#10;controls | Firm size (log assets)&#10;model | Firm fixed effects vs random effects" style="min-height:140px">${esc(ref.map((r) => `${r.category} | ${r.description}`).join('\n'))}</textarea><p class="actions"><button class="small" id="saveRef">Save list</button><button class="small ghost" id="loadBench">Load Berchicci &amp; King (2022) reference</button><button class="small ghost" id="runCompare" ${ref.length && F.choices.length ? '' : 'disabled'}>Align with AI choices</button></p></div>
  <div class="card"><h3>Benchmark summary</h3>${F.matches.length ? (() => { const found = F.matches.filter((m) => m.a?.length).length; const added = F.choices.filter((h) => h.status !== 'rejected' && !matched.has(h.key + '@' + h.study)).length; return `<p><strong>${found}/${ref.length}</strong> reference choices found by the AI (${Math.round(100 * found / Math.max(1, ref.length))}%), <strong>${ref.length - found}</strong> missed, <strong>${added}</strong> additional choices proposed.</p><table><tr><th>Reference choice</th><th>Matched AI choice(s)</th><th>Conf.</th></tr>${F.matches.map((m) => { const r = ref.find((x) => x.key === m.r) || {}; return `<tr><td>[${esc(r.category)}] ${esc(r.description)}</td><td>${(m.a || []).map((k) => { const [key, sid] = k.split('@'); const h = F.choices.find((x) => x.key === key && x.study === sid); return h ? `${esc(h.description)} <span class="muted">(${esc(short(study(sid)))})</span>` : esc(k); }).join('<br>') || '<span style="color:var(--bad)">missed</span>'}${m.note ? `<br><span class="small muted">${esc(m.note)}</span>` : ''}</td><td>${esc(m.confidence || '')}</td></tr>`; }).join('')}</table>`; })() : '<p class="muted">No alignment yet.</p>'}</div></div>
  ${Object.entries(bySt).map(([sid, list]) => `<div class="card"><h3>${esc(short(study(sid)))} <span class="small muted">${esc(study(sid)?.title || '')}</span></h3><table><tr><th>Category</th><th>Choice</th><th>Options</th><th>Alt. reported</th><th>Evidence</th><th>Status</th></tr>${list.map((h) => `<tr><td>${esc(h.category)}</td><td>${esc(h.description)}${matched.has(h.key + '@' + sid) ? ' <span class="status confirmed">in reference</span>' : ''}</td><td class="small">${esc((h.options || []).join(' | '))}</td><td>${h.alternatives_reported ? 'yes' : 'no'}</td><td class="quote">“${esc(h.quote)}” (p. ${h.page ?? '?'})</td><td>${statusBtns('choice', h.id, h.status)}</td></tr>`).join('')}</table></div>`).join('') || `<div class="empty-state"><h3>No analytical choices yet</h3><p>Choices are collected when you import an extraction in step 2.</p></div>`}`;
  $('#saveRef').addEventListener('click', () => { F.reference = $('#refText').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => { const [c, ...d] = l.split('|'); return { key: `r${i + 1}`, category: (d.length ? c : 'other').trim(), description: (d.length ? d.join('|') : c).trim() }; }); markDirty(); renderChoices(p); });
  $('#loadBench').addEventListener('click', async () => { const b = (await api('/api/benchmarks'))[0]; $('#refText').value = b.reference.map((r) => `${r.category} | ${r.description}`).join('\n'); toast(`${b.reference.length} reference choices loaded from ${b.name.split(':')[0]}. Click Save list.`); });
  $('#runCompare').addEventListener('click', async (e) => {
    busy(e.target, true, 'Aligning…');
    try { const A = F.choices.filter((h) => h.status !== 'rejected').map((h) => ({ key: `${h.key}@${h.study}`, category: h.category, description: h.description, options: h.options })); const r = await api('/api/compare', { fieldId: F.id, reference: F.reference, choices: A }); F.matches = r.matches || []; markDirty(); renderChoices(p); }
    catch (err) { toast(err.message, true); busy(e.target, false); }
  });
  p.addEventListener('click', (e) => { const { act, kind, id } = e.target.dataset; if (kind !== 'choice') return; const h = F.choices.find((x) => x.id === id); if (act === 'edit') { modal(`<h3>Edit choice</h3><form id="ef"><label>Category<input name="category" value="${esc(h.category)}"></label><label>Description<textarea name="description">${esc(h.description)}</textarea></label><label>Options (one per line)<textarea name="options">${esc((h.options || []).join('\n'))}</textarea></label><menu><button type="button" data-close class="ghost">Cancel</button><button>Save</button></menu></form>`, (b) => $('#ef', b).addEventListener('submit', (ev) => { ev.preventDefault(); const fd = new FormData(ev.target); h.category = fd.get('category'); h.description = fd.get('description'); h.options = fd.get('options').split('\n').map((x) => x.trim()).filter(Boolean); if (h.status === 'ai') h.status = 'confirmed'; markDirty(); $('#modal').close(); renderChoices(p); })); return; } h.status = act === 'confirm' ? 'confirmed' : 'rejected'; markDirty(); renderChoices(p); });
}

/* 6 EXPORT */
function renderExport(p) {
  const conf = (arr) => arr.filter((x) => x.status === 'confirmed').length;
  const as = F.assumptions.filter((a) => a.status === 'confirmed');
  const red = as.filter((a) => cellState(a.id).cls === 'none').sort((a, b) => b.consequential - a.consequential).slice(0, 10);
  p.innerHTML = `<h2>6. Export and summary</h2>
  <div class="card"><h3>Status of “${esc(F.name)}”</h3><table><tr><th></th><th>Total</th><th>Confirmed</th></tr><tr><td>Studies in corpus / core</td><td>${F.studies.length}</td><td>${F.studies.filter((s) => s.core).length}</td></tr><tr><td>Claims</td><td>${F.claims.length}</td><td>${conf(F.claims)}</td></tr><tr><td>Assumptions</td><td>${F.assumptions.length}</td><td>${as.length}</td></tr><tr><td>Coverage entries (study × assumption)</td><td>${F.coverage.length}</td><td>${conf(F.coverage)}</td></tr><tr><td>Analytical choices</td><td>${F.choices.length}</td><td>${conf(F.choices)}</td></tr></table>
  <p class="small muted">Diagnostic coverage (confirmed assumptions varied by at least one study): <strong>${as.length ? Math.round(100 * as.filter((a) => cellState(a.id).n).length / as.length) : 0}%</strong> unweighted; <strong>${(() => { const w = as.reduce((n, a) => n + a.consequential, 0); return w ? Math.round(100 * as.filter((a) => cellState(a.id).n).reduce((n, a) => n + a.consequential, 0) / w) : 0; })()}%</strong> weighted by consequentiality.</p></div>
  <div class="card"><h3>Most informative next tests</h3><p class="small muted">Confirmed assumptions no study has varied, ordered by consequentiality.</p>${red.length ? `<ol>${red.map((a) => `<li><span class="dim ${a.dimension}">${esc(dimName(a.dimension))}</span> ${esc(a.text)} <span class="muted small">(c=${a.consequential}; claim: ${esc(claim(a.claim)?.text.slice(0, 80))})</span> ${planLink(a)}</li>`).join('')}</ol>${CFG.navigatorUrl ? '' : '<p class="small muted">Set NAVIGATOR_URL on the server to add “Plan this test” links that open Replication Navigator with the claim and assumption pre-filled.</p>'}` : '<p class="muted">None, or nothing confirmed yet.</p>'}</div>
  <div class="card"><h3>Downloads</h3><p class="actions"><a href="/api/fields/${F.id}/export.json"><button>Field as JSON</button></a><a href="/api/fields/${F.id}/coverage.csv"><button class="ghost">Coverage table (CSV)</button></a></p><p class="small muted">The JSON holds everything (corpus, extractions, claims, assumptions, coverage, choices, reference list, matches, statuses) and can be re-imported later. The CSV is one row per assumption × study for analysis in R or Python.</p></div>
  <div class="card"><h3>Notes</h3><textarea id="notes" style="min-height:120px" placeholder="Coding decisions, who confirmed what, open questions…">${esc(F.notes || '')}</textarea></div>`;
  $('#notes').addEventListener('input', (e) => { F.notes = e.target.value; markDirty(); });
}

// ---------- boot ----------
(async () => { CFG = await api('/api/config'); const d = $('#dbState'); d.hidden = false; d.textContent = CFG.store === 'postgres' ? 'Database connected' : 'File storage'; d.classList.toggle('files', CFG.store !== 'postgres'); route(); })();
