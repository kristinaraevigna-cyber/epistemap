/* EpisteMap front end. Plain JS, no build step. One field = one JSON document kept in `F`. */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const REFS = {
  king2021: ['King, Goldfarb & Simcoe (2021)', 'King, A. A., Goldfarb, B., & Simcoe, T. (2021). Learning from testimony on quantitative research in management. Academy of Management Review, 46(3), 465–488.', 'https://doi.org/10.5465/amr.2018.0421'],
  goldfarb2021: ['Goldfarb & Yan (2021)', 'Goldfarb, B., & Yan, L. (2021). Revisiting Zuckerman\'s (1999) categorical imperative: An application of epistemic maps for replication. Strategic Management Journal, 42(11), 1963–1992.', 'https://doi.org/10.1002/smj.3290'],
  berchicci2022: ['Berchicci & King (2022)', 'Berchicci, L., & King, A. A. (2022). Building knowledge by mapping model uncertainty in six studies of social and financial performance. Strategic Management Journal, 43(7), 1317–1343.', 'https://doi.org/10.1002/smj.3374'],
  gotz2026: ['Götz et al. (2026)', 'Götz, M., Carnes, C. M., Hill, A. D., & O\'Boyle, E. H. (2026). Multiverse analysis to advance theory and practice. Academy of Management Journal, 69(4), 857–887.', 'https://doi.org/10.5465/amj.2024.0355'],
  delios2025: ['Delios et al. (2025)', 'Delios, A., Hu, T., Yu, S., Zhou, N., Uhlmann, E. L., et al. (2025). The insights from the crowd: Drawing inferences from many approaches to key empirical questions in international business. Journal of International Business Studies, 56, 1102–1124.', 'https://doi.org/10.1057/s41267-025-00808-9'],
  silberzahn2018: ['Silberzahn et al. (2018)', 'Silberzahn, R., Uhlmann, E. L., Martin, D. P., et al. (2018). Many analysts, one data set: Making transparent how variations in analytic choices affect results. Advances in Methods and Practices in Psychological Science, 1(3), 337–356.', 'https://doi.org/10.1177/2515245917747646'],
  breznau2022: ['Breznau et al. (2022)', 'Breznau, N., Rinke, E. M., Wuttke, A., et al. (2022). Observing many researchers using the same data and hypothesis reveals a hidden universe of uncertainty. Proceedings of the National Academy of Sciences, 119(44), e2203150119.', 'https://doi.org/10.1073/pnas.2203150119'],
  hk2021: ['Huntington-Klein et al. (2021)', 'Huntington-Klein, N., Arenas, A., Beam, E., et al. (2021). The influence of hidden researcher decisions in applied microeconomics. Economic Inquiry, 59(3), 944–960.', 'https://doi.org/10.1111/ecin.12992'],
  steegen2016: ['Steegen et al. (2016)', 'Steegen, S., Tuerlinckx, F., Gelman, A., & Vanpaemel, W. (2016). Increasing transparency through a multiverse analysis. Perspectives on Psychological Science, 11(5), 702–712.', 'https://doi.org/10.1177/1745691616658637']
};
const refLink = (k, label) => { const r = REFS[k]; return r ? `<a class="ref" href="${r[2]}" target="_blank" rel="noopener" title="${r[1].replace(/"/g, '&quot;')} — opens the publisher page">${label || r[0]}</a>` : (label || k); };
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
let CFG = { dimensions: [] }, TEAM_ID = null, SHOW_REJECTED = false, VIEW_CHOICES = 'category', F = null, VERSION = 0, STEP = 'corpus', saveTimer = null, KNOW = null;
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
  const m = /^field\/([^/]+)(?:\/(\w+))?(?:\/([\w-]+))?/.exec(h);
  if (!m) { F = null; $('#work').hidden = true; $('#home').hidden = false; $('#fieldName').hidden = true; document.body.classList.add('on-home'); return renderHome(); }
  document.body.classList.remove('on-home');
  if (!F || F.id !== m[1]) { F = await api(`/api/fields/${m[1]}`); VERSION = F.version || 1; lastSaved = JSON.stringify(F); }
  STEP = m[2] || ((F.inquiry?.statement || F.studies.length) ? 'corpus' : 'inquiry'); TEAM_ID = (m[2] === 'team' || m[2] === 'judge') ? m[3] : null; document.body.classList.toggle('team-view', !!TEAM_ID);
  $('#home').hidden = true; $('#work').hidden = false; $('#fieldName').textContent = F.name; $('#fieldName').hidden = false;
  document.querySelectorAll('#steps li').forEach((li) => li.classList.toggle('active', li.dataset.step === STEP));
  if (!CARDS) cardsIndex().then(() => { if (STEP === 'assumptions') renderStep(); }).catch(() => {});
  updateCounts(); renderStep(); $('#panel').scrollTop = 0; window.scrollTo(0, 0); renderStarters(); renderChat();
}
window.addEventListener('hashchange', route);
$('#steps').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) location.hash = `field/${F.id}/${li.dataset.step}`; });
$('#exportJson').addEventListener('click', (e) => { e.preventDefault(); if (F) location.href = `/api/fields/${F.id}/export.json`; });
$('#deleteField').addEventListener('click', async (e) => { e.preventDefault(); if (!F) return; const typed = prompt(`Delete the field “${F.name}” and everything in it? This cannot be undone.\n\nType DELETE to confirm:`); if (typed !== 'DELETE') return; try { await api(`/api/fields/${F.id}`, null, 'DELETE'); const name = F.name; F = null; location.hash = 'home'; toast(`Deleted “${name}”.`); } catch (err) { toast(err.message, true); } });

function updateCounts() {
  if (!F) return;
  const conf = (a) => a.filter((x) => x.status === 'confirmed').length;
  const core = F.studies.filter((s) => s.core).length, read = F.studies.filter((s) => s.extraction).length;
  const set = (id, txt, done) => { const el = $('#' + id); if (el) { el.textContent = txt; el.closest('li').classList.toggle('done', !!done); } };
  set('c-inquiry', F.inquiry?.statement ? 'stated' : 'not yet', !!F.inquiry?.statement);
  const decs = Object.values(F.decisions || {}).map((d) => d.choice).filter(Boolean); const mvRoute = decs.some((d) => d === 'multiverse' || d === 'both'); const otherRoute = decs.length && !mvRoute;
  set('c-multiverse', otherRoute ? 'optional for your decision' : (Object.keys(F.space || {}).length ? 'space set' : (mvRoute ? 'your route' : 'not started')), Object.keys(F.space || {}).length);
  set('c-teams', (F.teams || []).length || (F.runs || []).length ? `${(F.teams || []).length} team${(F.teams || []).length === 1 ? '' : 's'} · ${(F.runs || []).length} result${(F.runs || []).length === 1 ? '' : 's'}` : (otherRoute ? 'optional for your decision' : 'not started'), (F.runs || []).length);
  set('c-assumptions', Object.keys(F.assumptions_by_prediction || {}).length ? `${Object.values(F.assumptions_by_prediction).flat().filter((a) => a.judgment).length} judged · ${Object.keys(F.decisions || {}).length} decided` : 'not started', Object.keys(F.decisions || {}).length);
  set('c-corpus', F.studies.length ? `${F.studies.length} studies · ${core} core` : 'not started', core);
  set('c-studies', read ? `${read} read` : 'no PDFs yet', read);
  const coreP = F.predictions.filter((x) => x.status === 'confirmed' && x.core).length;
  set('c-predictions', F.predictions.length ? `${conf(F.predictions)}/${F.predictions.length} confirmed · ${coreP} core` : 'nothing to review', conf(F.predictions));
  set('c-designs', F.tests.length ? `${conf(F.tests)}/${F.tests.length} tests confirmed` : 'no tests yet', conf(F.tests));
  set('c-choices', F.choices.length ? `${F.choices.length} choices${F.matches.length ? ' · aligned' : ''}` : 'no choices yet', F.matches.length);
  set('c-export', '', false);
}

// ---------- home ----------
let homeBound = false;
function drawConstellation() {
  const svg = $('#constellation'); if (!svg || svg.dataset.done) return; svg.dataset.done = '1';
  const W = 1200, H = 520, N = 42, pts = []; let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < N; i++) pts.push({ x: rnd() * W, y: rnd() * H, r: 2 + rnd() * 4, d: 6 + rnd() * 10, p: rnd() * 6 });
  const cols = ['#5EEAD4', '#818CF8', '#FDE68A', '#FFFFFF'];
  let html = '';
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const a = pts[i], b = pts[j]; const dd = Math.hypot(a.x - b.x, a.y - b.y); if (dd < 170) html += `<line x1="${a.x.toFixed(0)}" y1="${a.y.toFixed(0)}" x2="${b.x.toFixed(0)}" y2="${b.y.toFixed(0)}" stroke="#fff" stroke-opacity="${(0.35 * (1 - dd / 170)).toFixed(2)}" stroke-width="1"/>`; }
  for (const p of pts) html += `<circle cx="${p.x.toFixed(0)}" cy="${p.y.toFixed(0)}" r="${p.r.toFixed(1)}" fill="${cols[Math.floor(p.p) % cols.length]}" opacity=".9"><animate attributeName="opacity" values=".4;1;.4" dur="${p.d.toFixed(1)}s" repeatCount="indefinite"/></circle>`;
  svg.innerHTML = html;
}
function bindHome() {
  if (homeBound) return; homeBound = true;
  $('#ctaTop')?.addEventListener('click', (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => $('#newName')?.focus(), 400); });
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 }) : null;
  document.querySelectorAll('.reveal').forEach((el) => io ? io.observe(el) : el.classList.add('in'));
  // stepper banner: auto-advances every 6 s; clicking a step or an arrow stops it; hovering pauses it
  const st = $('#stepper'), rail = $('#rail'), det = $('#railDetail');
  const texts = JSON.parse(det.dataset.details || '[]'), titles = JSON.parse(st.dataset.titles || '[]'), subs = JSON.parse(st.dataset.subs || '[]');
  const DUR = 6000; let cur = 0, timer = null, playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bar = $('#stepBar');
  const show = (i) => {
    cur = (i + texts.length) % texts.length;
    rail.querySelectorAll('button').forEach((b) => { const k = Number(b.dataset.i); b.classList.toggle('active', k === cur); b.classList.toggle('done', k < cur); });
    $('#stepK').textContent = `Step ${cur} · ${cur + 1} of ${texts.length} · ${subs[cur] || ''}`; $('#stepTitle').textContent = titles[cur] || ''; $('#stepText').textContent = texts[cur] || '';
    const body = $('.step-body'); body.classList.remove('fade'); void body.offsetWidth; body.classList.add('fade');
    bar.style.transition = 'none'; bar.style.width = '0'; void bar.offsetWidth;
    if (playing) { bar.style.transition = `width ${DUR}ms linear`; bar.style.width = '100%'; }
  };
  const tick = () => { timer = setInterval(() => show(cur + 1), DUR); };
  const stop = () => { playing = false; clearInterval(timer); timer = null; bar.style.transition = 'none'; bar.style.width = '0'; };
  rail.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; stop(); show(Number(b.dataset.i)); });
  $('#stepPrev').addEventListener('click', () => { stop(); show(cur - 1); }); $('#stepNext').addEventListener('click', () => { stop(); show(cur + 1); });
  st.addEventListener('mouseenter', () => { if (playing) { clearInterval(timer); timer = null; bar.style.transition = 'none'; } });
  st.addEventListener('mouseleave', () => { if (playing && !timer) { show(cur); tick(); } });
  show(0); if (playing) tick();
}
async function renderHome() {
  bindHome();
  const list = await api('/api/fields');
  $('#fieldsCard').hidden = !list.length;
  $('#fieldCount').textContent = list.length ? `${list.length} field${list.length > 1 ? 's' : ''}` : ''; $('#fieldList').innerHTML = list.length ? list.map((f) => `<li><a href="#field/${f.id}">${esc(f.name)}</a><span class="muted small">${f.studies} studies · ${f.predictions ?? 0} predictions · ${new Date(f.updated).toLocaleDateString()}</span><span class="actions"><a class="small" href="#field/${f.id}">Open →</a><button class="small ghost" data-rename="${f.id}" data-name="${esc(f.name)}" title="Rename">Rename</button><button class="small danger" data-delete="${f.id}" data-name="${esc(f.name)}" title="Delete this field">Delete</button></span></li>`).join('') : '<li class="empty">No fields yet. Name one above to start.</li>';
}
$('#fieldList').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-delete]'); const ren = e.target.closest('[data-rename]');
  if (del) {
    const name = del.dataset.name;
    const typed = prompt(`Delete the field “${name}” and everything in it (corpus, extractions, predictions, decisions)? This cannot be undone.\n\nType DELETE to confirm:`);
    if (typed !== 'DELETE') return;
    try { await api(`/api/fields/${del.dataset.id || del.dataset.delete}`, null, 'DELETE'); toast(`Deleted “${name}”.`); renderHome(); } catch (err) { toast(err.message, true); }
  }
  if (ren) {
    const name = prompt('New name for this field:', ren.dataset.name); if (!name || name.trim() === ren.dataset.name) return;
    try { const f = await api(`/api/fields/${ren.dataset.rename}`); f.name = name.trim().slice(0, 200); await api(`/api/fields/${f.id}`, { doc: f, version: f.version }, 'PUT'); toast('Renamed.'); renderHome(); } catch (err) { toast(err.message, true); }
  }
});
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

// Hand-off to Evidence Navigator: open it with the claim and the assumption to vary pre-filled.
const DD = () => CFG.designDimensions || [];
const ddName = (id) => (DD().find((d) => d.id === id) || {}).name || id;
const pred = (id) => F.predictions.find((p) => p.id === id);
const testsOf = (pid) => F.tests.filter((t) => t.prediction === pid && t.status !== 'rejected');
const typeBadge = (s) => (s.seed ? '<span class="status confirmed">seed</span> ' : '') + (s.paper_type ? `<span class="status ${s.paper_type === 'empirical' ? 'confirmed' : 'candidate'}">${esc(s.paper_type)}</span>` : (s.is_review ? '<span class="status candidate">review?</span>' : ''));

// Hand-off to Evidence Navigator: open it with the prediction, the original study and the design range pre-filled.
function planLink(p, focus) {
  if (!CFG.navigatorUrl) return '';
  const ts = testsOf(p.id); const t0 = ts[0]; const s = t0 ? study(t0.study) : study(p.study);
  const citation = s ? [s.authors, s.year ? `(${s.year})` : '', s.title, s.venue, s.doi ? `https://doi.org/${s.doi}` : ''].filter(Boolean).join('. ') : '';
  const range = DD().map((d) => { const opts = [...new Set(ts.map((t) => (t.design || {})[d.id]).filter(Boolean).map((v) => Array.isArray(v) ? v.join(', ') : v))]; return opts.length > 1 ? `${d.name}: ${opts.join(' | ')}` : null; }).filter(Boolean).join('; ');
  const coverage = `Tested in ${ts.length} stud${ts.length === 1 ? 'y' : 'ies'}: ${ts.map((t) => `${short(study(t.study))} (${t.result?.direction || '?'}, ${t.result?.support || '?'})`).join('; ')}. Design choices that vary across studies: ${range || 'none recorded'}.`;
  const dec = (F.decisions || {})[p.id]; const viol = ((F.assumptions_by_prediction || {})[p.id]?.assumptions || []).filter((a) => a.judgment === 'violated' || a.judgment === 'questionable');
  const aim = focus?.choice ? `Decision in EpisteMap: ${focus.choice}${focus.reason ? ' — ' + focus.reason : ''}. ${viol.length ? 'Assumptions judged questionable or violated: ' + viol.map((a) => a.text + (a.relaxed_by ? ' (relax by: ' + a.relaxed_by + ')' : '')).join('; ') : ''}` : null;
  const plan = { field: F.name, claimId: p.id, assumptionId: focus?.id || null, citation, claim: p.statement || p.text, dimension: focus?.id ? ddName(focus.id) : 'research design', assumption: aim || (focus?.id ? `${ddName(focus.id)}: options used so far: ${focus.options.join(' | ')}` : `Which design decision matters most for "${p.text}"?`), coverage: coverage + (dec?.reason && !aim ? ` Decision: ${dec.choice} — ${dec.reason}` : '') };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(plan)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `<a class="plan-link" href="${CFG.navigatorUrl}/?plan=${b64}" target="_blank" rel="noopener" title="Open Evidence Navigator with this study, prediction and design decision pre-filled. The Navigator plans a new study against this one, whether you call it a replication, an extension or a new design.">Plan the new study in Navigator →</a>`;
}

// ---------- steps ----------
const STEP_ORDER = ['inquiry', 'corpus', 'studies', 'predictions', 'designs', 'assumptions', 'choices', 'multiverse', 'teams', 'export'];
const STEP_NAMES = { inquiry: '0 · Your inquiry', corpus: '1 · Corpus', studies: '2 · Studies', predictions: '3 · Predictions', designs: '4 · Design map', assumptions: '5 · Assumptions & decision', choices: '6 · Choice space', multiverse: '7 · Multiverse', teams: '8 · Many analysts', export: '9 · Reproduce, replicate, export' };
function stepNav() {
  const i = STEP_ORDER.indexOf(STEP); if (i < 0) return;
  const prev = STEP_ORDER[i - 1], next = STEP_ORDER[i + 1];
  const el = document.createElement('div'); el.className = 'stepnav';
  el.innerHTML = `<div>${prev ? `<button class="ghost" data-go="${prev}">← ${esc(STEP_NAMES[prev])}</button>` : ''}</div><div class="small muted">Everything you do here is saved automatically</div><div>${next ? `<button data-go="${next}">${esc(STEP_NAMES[next])} →</button>` : ''}</div>`;
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) location.hash = `field/${F.id}/${b.dataset.go}`; });
  $('#panel').appendChild(el);
}
function renderStep() {
  // Replace the panel node so listeners added by the previous render are dropped (they would otherwise stack).
  const old = $('#panel'); const p = old.cloneNode(false); old.replaceWith(p);
  ({ inquiry: renderInquiry, corpus: renderCorpus, studies: renderStudies, predictions: renderPredictions, designs: renderDesigns, assumptions: renderAssumptions, choices: renderChoices, multiverse: renderMultiverse, teams: renderTeams, export: renderExport, team: renderTeam, judge: renderJudge }[STEP] || renderCorpus)(p);
  if (STEP !== 'team' && STEP !== 'judge') stepNav();
}


// ---------- loops: the human sends the tool back ----------
async function loopBack(to, reason, note) {
  F.loops.push({ at: new Date().toISOString(), from: STEP, to, reason, note: String(note || '').slice(0, 500) });
  markDirty(); api('/api/event', { fieldId: F.id, type: 'loop_back', payload: { from: STEP, to, reason } }).catch(() => {});
  location.hash = `field/${F.id}/${to}`;
}
function loopBar() {
  return `<div class="loopbar"><strong>Not satisfied?</strong> Send the tool back: <button class="small ghost" data-loop="corpus" data-reason="revise_search">Revise the search terms</button><button class="small ghost" data-loop="corpus" data-reason="add_studies">Add studies the tool should weigh</button><button class="small ghost" data-loop="predictions" data-reason="own_prediction">Add a prediction from my own reading</button><button class="small ghost" data-loop="inquiry" data-reason="restate">Restate my inquiry</button></div>`;
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-loop]'); if (!b || !F) return; const note = prompt('What should the tool pay more attention to? (optional)') ?? ''; loopBack(b.dataset.loop, b.dataset.reason, note); });

/* 0 INQUIRY: the human goes first */
function renderInquiry(p) {
  const q = F.inquiry || (F.inquiry = { statement: '', terms: '', seeds: '', priors: '' });
  const canDictate = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  p.innerHTML = `<h2>0. Your inquiry</h2>
  <div class="intro">You go first. Say what you want to understand, in your own words; list the search terms and the studies you already know matter; and write down what you suspect the field takes for granted. The tool proposes only after this. Your seed studies are weighed; your suspicions are <strong>sealed</strong>: the tool does not see them while it reads the papers or unearths assumptions, so it cannot simply echo them. Afterwards (step 5) it compares what it found with what you suspected, and the coach treats your suspicions as hypotheses to test, not as facts. You can come back here at any time.</div>
  <div class="card"><label>What do you want to understand, and why? ${canDictate ? '<button type="button" class="small ghost" id="dictate">🎙 Dictate</button>' : ''}<textarea id="iqStatement" style="min-height:120px" placeholder="e.g. Whether CEO narcissism changes firm risk-taking, and whether the field's estimates depend on how narcissism is measured…">${esc(q.statement)}</textarea></label>
  <div class="grid2"><label>Search terms <span class="muted">(phrases in quotes; OR / AND / NOT)</span><textarea id="iqTerms" placeholder='"CEO narcissism" OR "narcissistic CEO" AND (risk OR "risk-taking")'>${esc(q.terms)}</textarea></label>
  <label>Seed studies you already know <span class="muted">(one per line: DOI or citation)</span><textarea id="iqSeeds" placeholder="10.1002/smj.1234&#10;Chatterjee & Hambrick (2007) ASQ">${esc(q.seeds)}</textarea></label></div>
  <label>What do you suspect the field takes for granted? <span class="muted">(assumptions you suspect, debates you know of, studies you think are superseded — sealed from the tool until it has read the papers; compared in step 5)</span><textarea id="iqPriors" placeholder="e.g. Most studies use unobtrusive measures from annual reports; nobody has tested the effect within firms over time…">${esc(q.priors)}</textarea></label>
  <p class="actions"><button id="iqToSearch">Use these terms in the search →</button><button class="ghost" id="iqAddSeeds">Add seed studies to the corpus</button></p></div>
  ${F.loops.length ? `<div class="card"><h3>Loops so far</h3><ul class="small">${F.loops.map((l) => `<li>${new Date(l.at).toLocaleString()}: from ${esc(l.from)} back to ${esc(l.to)} (${esc(l.reason.replace(/_/g, ' '))})${l.note ? ` — “${esc(l.note)}”` : ''}</li>`).join('')}</ul></div>` : ''}`;
  for (const [id, k] of [['iqStatement', 'statement'], ['iqTerms', 'terms'], ['iqSeeds', 'seeds'], ['iqPriors', 'priors']]) $('#' + id).addEventListener('input', (e) => { F.inquiry[k] = e.target.value; markDirty(); });
  $('#iqToSearch').addEventListener('click', () => { sessionStorage.setItem('cm.prefillQuery', F.inquiry.terms || F.inquiry.statement.slice(0, 120)); location.hash = `field/${F.id}/corpus`; });
  $('#iqAddSeeds').addEventListener('click', async (e) => {
    const lines = (F.inquiry.seeds || '').split('\n').map((x) => x.trim()).filter(Boolean); let n = 0; const added = [];
    for (const l of lines) { const doi = /10\.\d{4,}\/\S+/.exec(l)?.[0]?.replace(/[.,;)]+$/, '').toLowerCase(); const year = Number(/\((\d{4})\)/.exec(l)?.[1] || /\b((?:19|20)\d{2})\b/.exec(l)?.[1]) || null; if (F.studies.some((s) => (doi && s.doi === doi) || s.title === l)) continue; const st = { id: uid('s_'), doi: doi || null, title: l, authors: '', year, venue: '', cited_by: null, local_cites: 0, references: [], source: 'seed', abstract: '', core: true, status: 'core', extraction: null, seed: true, added: new Date().toISOString() }; F.studies.push(st); added.push(st); n++; }
    markDirty(); toast(`${n} seed stud${n === 1 ? 'y' : 'ies'} added as core.`);
    const dois = added.map((s) => s.doi).filter(Boolean);
    if (dois.length) { busy(e.target, true, 'Looking up citations…'); try { const r = await api('/api/openalex/resolve', { dois }); let k = 0; for (const rec of r.studies) { const st = added.find((s) => s.doi === rec.doi); if (!st) continue; Object.assign(st, { id: rec.id, title: rec.title, authors: rec.authors, year: rec.year, venue: rec.venue, cited_by: rec.cited_by, cites_per_year: rec.cites_per_year, references: rec.references, abstract: rec.abstract, is_review: rec.is_review, type: rec.type }); k++; } markDirty(); if (k) toast(`${k} citation${k === 1 ? '' : 's'} filled in from OpenAlex`); } catch (err) { toast(`Added, but OpenAlex lookup failed: ${err.message}`, true); } finally { busy(e.target, false); } }
  });
  const d = $('#dictate'); if (d) d.addEventListener('click', () => { const R = window.SpeechRecognition || window.webkitSpeechRecognition; const r = new R(); r.lang = 'en-US'; r.interimResults = false; r.continuous = true; d.textContent = '● Listening… click to stop'; r.onresult = (ev) => { for (const res of ev.results) if (res.isFinal) { $('#iqStatement').value += (($('#iqStatement').value ? ' ' : '') + res[0].transcript); F.inquiry.statement = $('#iqStatement').value; markDirty(); } }; r.onend = () => (d.textContent = '🎙 Dictate'); d.onclick = () => { r.stop(); d.onclick = null; renderStep(); }; r.start(); });
}

/* 5 ASSUMPTIONS & DECISION: the judgment step */
function renderAssumptions(p) {
  const core = F.predictions.filter((x) => x.status === 'confirmed' && x.core);
  const AB = F.assumptions_by_prediction || (F.assumptions_by_prediction = {}); const DEC = F.decisions || (F.decisions = {});
  const J = { reasonable: 'confirmed', questionable: 'ai', violated: 'rejected' };
  p.innerHTML = `<h2>5. Judge the assumptions, then decide</h2>
  <div class="intro">Claims are visible; assumptions are hidden, sometimes even to the authors. For each core prediction the tool <strong>unearths</strong> the assumptions that the designs rest on (e.g. no omitted variables, the proxy captures the construct, the window is representative, and many more) and rates how sensitive the result is to each. <strong>You judge</strong> whether each assumption is reasonable, questionable or violated, from your knowledge of the field. Then you <strong>decide</strong>: if the existing designs are sound, a multiverse of the existing data is the efficient next step; if they share a violated assumption, a new study with a different design is needed; or the prediction is not worth more effort.</div>
  ${core.length ? core.map((pr) => { const as = AB[pr.id]; const dec = DEC[pr.id] || {}; const ts = testsOf(pr.id); return `<div class="card" data-pid="${pr.id}"><div class="row" style="justify-content:space-between"><div><strong>★ ${esc(pr.text)}</strong><br><span class="small muted">${ts.length} test${ts.length === 1 ? '' : 's'}; ${ts.filter((t) => t.result?.support === 'supported').length} supported</span></div><span class="actions">${as ? `<button class="small ghost" data-unearth="${pr.id}">Unearth again</button>${(as.assumptions || []).some((x) => x.judgment) ? `<button class="small ghost" data-challenge="${pr.id}" title="The tool argues the other side of each judgment where it has a case; you keep or change your judgment, and the exchange is logged">Challenge my judgments</button>` : ''}${F.inquiry?.priors ? `<button class="small ghost" data-priors="${pr.id}" title="The tool unearthed these assumptions without seeing your step-0 suspicions. This compares the two and says where the papers do not support what you suspected.">Compare with what I suspected</button>` : ''}` : `<button class="small" data-unearth="${pr.id}">Unearth assumptions</button>`}<button class="small ghost" data-add-a="${pr.id}">Add my own</button></span></div>
    ${as ? `<table style="margin-top:.6rem"><tr><th>Assumption the designs rest on</th><th>From</th><th>S</th><th>Would be relaxed by</th><th>Your judgment</th></tr>${as.assumptions.map((a, i) => `<tr><td>${esc(a.text)}${a.grounding?.length ? `<br>${a.grounding.map((g) => `<a class="cite ${g.valid ? '' : 'bad'}" data-card="${esc(g.id)}">${esc(g.id)}</a>`).join(' ')}` : ''}${a.mine ? ' <span class="status confirmed">yours</span>' : ''}</td><td class="small">${esc((a.source || []).map(ddName).join(', '))}${a.shared_by && a.shared_by !== 'all' ? `<br>${esc(Array.isArray(a.shared_by) ? a.shared_by.join(', ') : a.shared_by)}` : ''}</td><td>${a.sensitivity ?? ''}</td><td class="small">${esc(a.relaxed_by || '')}</td><td><select data-judge="${pr.id}:${i}"><option value="">—</option>${['reasonable', 'questionable', 'violated'].map((j) => `<option ${a.judgment === j ? 'selected' : ''}>${j}</option>`).join('')}</select><input data-jnote="${pr.id}:${i}" placeholder="why (optional)" value="${esc(a.note || '')}" style="margin-top:.3rem"></td></tr>`).join('')}</table>
    ${as.gaps?.length ? `<p class="small" style="margin-top:.5rem"><strong>Design options no study has used:</strong> ${as.gaps.map(esc).join(' · ')}</p>` : ''}${as.overlaps?.length ? `<p class="small"><strong>Possible overlaps with other predictions:</strong> ${as.overlaps.map((o) => `${esc(pred(o.prediction)?.text || o.prediction)} (${esc(o.why)})`).join(' · ')}</p>` : ''}
    ${as ? (() => { const judged = (as.assumptions || []).filter((x) => x.judgment); const allR = judged.length >= 3 && judged.every((x) => x.judgment === 'reasonable'); const hot = judged.filter((x) => x.judgment === 'reasonable' && Number(x.sensitivity) >= 3).length; return allR && !as.challenge ? `<div class="note" style="margin-top:.5rem"><strong>You judged all ${judged.length} assumptions reasonable.</strong> ${hot ? `The tool rated ${hot} of them highly sensitive (the result would change if they failed). ` : ''}That may well be right, but a map whose every assumption is reasonable has nothing to test. <button class="small" data-challenge="${pr.id}">Let the tool argue the other side</button></div>` : ''; })() : ''}
    ${as?.challenge ? `<div class="note" style="margin-top:.5rem"><strong>The tool's case against your judgments</strong> <span class="small muted">(${as.challenge.items.filter((x) => x.stance === 'disagree').length} disagreements, ${as.challenge.items.filter((x) => x.stance === 'agree').length} agreements; the verdict follows the tool's own judgment of each assumption, not the other way round; it is a sparring partner, not a referee: keep or change each judgment)</span><table style="margin-top:.3rem"><tr><th>Assumption</th><th>Your judgment</th><th>The tool's case</th><th>You decide</th></tr>${as.challenge.items.map((c) => { const i = as.assumptions.findIndex((x) => (x.key || '') === c.key); const x = as.assumptions[i]; if (!x) return ''; return `<tr><td class="small">${esc(x.text)}</td><td><span class="status ${{ reasonable: 'confirmed', questionable: 'ai', violated: 'rejected' }[x.judgment] || ''}">${esc(x.judgment || '—')}</span>${x.changed_after_challenge ? `<br><span class="small muted">changed from ${esc(x.changed_after_challenge)}</span>` : ''}</td><td class="small">${c.stance === 'agree' ? `<span class="status confirmed">agrees</span>` : `<span class="status rejected">disagrees</span>`}${c.tool_judgment ? ` <span class="muted">(it would judge: ${esc(c.tool_judgment)})</span>` : ''}${c.label_corrected ? ` <span class="muted" title="The first verdict (${esc(c.label_was || '')}) contradicted the argument; a second reading of the case set the verdict. Logged.">· verdict re-read</span>` : ''} ${cites(c.case)}${c.stance === 'disagree' && c.would_change_if ? `<br><em>Would change its mind if:</em> ${esc(c.would_change_if)}` : ''}</td><td>${c.stance === 'disagree' ? `<span class="actions"><button class="small ghost" data-keep="${pr.id}:${i}">Keep mine</button>${['reasonable', 'questionable', 'violated'].filter((v) => v !== x.judgment).map((v) => `<button class="small ghost" data-rejudge="${pr.id}:${i}:${v}">Change to ${v}</button>`).join('')}<button class="small ghost" data-discuss="${pr.id}:${i}">Discuss with the coach</button></span>` : ''}</td></tr>`; }).join('')}</table></div>` : ''}
    ${as ? indepBlock(pr.id) : ''}
    ${as?.priors_check ? `<div class="note" style="margin-top:.5rem"><strong>Your step-0 suspicions, compared with what the tool unearthed blind:</strong><table style="margin-top:.3rem"><tr><th>You suspected</th><th>What the papers show</th><th>Verdict</th></tr>${as.priors_check.map((x) => `<tr><td class="small">${esc(x.prior)}</td><td class="small">${esc(x.evidence)}</td><td><span class="status ${x.verdict === 'supported' ? 'confirmed' : x.verdict === 'contradicted' ? 'rejected' : 'candidate'}">${esc(x.verdict)}</span></td></tr>`).join('')}</table><p class="small muted">Unearthed assumptions the tool found that you did not mention: ${as.priors_check_extra?.length ? as.priors_check_extra.map(esc).join(' · ') : 'none'}. A “supported” verdict means the papers' designs rest on it, not that it is true.</p></div>` : ''}
    <div class="decision"><strong>Decision for this prediction</strong>
      <p class="small muted" style="margin:.2rem 0 .4rem">Before deciding, you can ask for an assessment that starts from <em>your</em> judgments above (the tool proposes; you decide).</p>
      <p class="actions"><button class="small ghost" data-assess="${pr.id}">${dec.assessment ? 'Re-assess from my judgments' : 'Assess from my judgments'}</button></p>
      ${dec.assessment ? `<div class="note"><strong>Assessment (from your ${(as.assumptions || []).filter((x) => x.judgment).length} judgments):</strong> ${cites(dec.assessment.summary)}<ul class="small">${(dec.assessment.routes || []).map((r) => `<li><strong>${esc(r.route)}</strong> — ${esc(r.verdict)}: ${cites(r.why)}</li>`).join('')}</ul>${dec.assessment.violated_to_address?.length ? `<p class="small"><strong>A new design would have to address:</strong> ${dec.assessment.violated_to_address.map(esc).join(' · ')}</p>` : ''}</div>` : ''}
      <div class="row" style="margin:.4rem 0">${[['multiverse', '<strong>Multiverse</strong> on existing data → step 7 (the designs are sound enough; map the specification space)'], ['replication', '<strong>Replication</strong> of a specific study with one design decision varied → Evidence Navigator'], ['both', '<strong>Both</strong>: a replication, then a multiverse of it → steps 7–8 and Navigator'], ['newdesign', '<strong>New design</strong> (too many assumptions violated for the existing data to settle it) → recorded as a brief; the multiverse steps become optional'], ['stop', '<strong>Stop</strong>: not worth more effort now']].map(([v, l]) => `<label class="radio"><input type="radio" name="dec-${pr.id}" value="${v}" ${dec.choice === v ? 'checked' : ''}> ${l}</label>`).join('')}</div><input data-dreason="${pr.id}" placeholder="Your reason, in one sentence (goes into the plan and the export)" value="${esc(dec.reason || '')}">${dec.choice ? `<div style="margin-top:.4rem">${dec.choice === 'multiverse' || dec.choice === 'both' ? `<a class="plan-link" href="#field/${F.id}/multiverse">Build the multiverse (step 7) →</a> ` : ''}${dec.choice === 'replication' || dec.choice === 'both' ? planLink(pr, dec) : ''}${dec.choice === 'newdesign' ? '<span class="small muted">Recorded with your reason. The assumptions you judged violated are listed in the export as the brief for a new design; the coach can discuss designs with you now, and a dedicated design step is planned.</span>' : ''}${dec.choice === 'stop' ? '<span class="small muted">Recorded. Nothing further for this prediction.</span>' : ''}</div>` : ''}</div>` : '<p class="small muted" style="margin-top:.5rem">Click “Unearth assumptions” when the design map for this prediction is reasonably complete.</p>'}</div>`; }).join('') : `<div class="empty-state"><h3>No core predictions confirmed</h3><p>Confirm predictions and tick the core ones in step 3 first.</p><button class="ghost small" onclick="location.hash='field/${F.id}/predictions'">Go to step 3</button></div>`}
  ${loopBar()}`;
  p.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.dataset.challenge) { const pid = t.dataset.challenge; const ab = AB[pid]; const judged = (ab?.assumptions || []).filter((x) => x.judgment); if (!judged.length) return toast('Judge some assumptions first', true); busy(t, true, 'Arguing…'); try { const pr = pred(pid); const r = await api('/api/challenge', { fieldId: F.id, prediction: { id: pid, text: pr.text, statement: pr.statement }, assumptions: ab.assumptions.map((x, i) => ({ key: x.key || String(i), text: x.text, judgment: x.judgment, note: x.note, sensitivity: x.sensitivity, source: x.source, relaxed_by: x.relaxed_by })), tests: testsOf(pid).map((x) => ({ study: short(study(x.study)), design: x.design, result: x.result })) }); ab.assumptions.forEach((x, i) => { if (!x.key) x.key = String(i); }); ab.challenge = { items: r.items, at: new Date().toISOString() }; markDirty(); renderStep(); } catch (err) { toast(err.message, true); busy(t, false); } return; }
    if (t.dataset.keep) { const [pid, i] = t.dataset.keep.split(':'); const x = AB[pid].assumptions[Number(i)]; x.kept_after_challenge = true; api('/api/event', { fieldId: F.id, type: 'judgment', payload: { prediction: pid, key: x.key, judgment: x.judgment, after_challenge: 'kept' } }).catch(() => {}); toast('Kept. Logged as a judgment that survived the challenge.'); return; }
    if (t.dataset.rejudge) { const [pid, i, v] = t.dataset.rejudge.split(':'); const x = AB[pid].assumptions[Number(i)]; x.changed_after_challenge = x.judgment; x.judgment = v; markDirty(); api('/api/event', { fieldId: F.id, type: 'judgment', payload: { prediction: pid, key: x.key, judgment: v, after_challenge: 'changed', from: x.changed_after_challenge } }).catch(() => {}); renderStep(); return; }
    if (t.dataset.discuss) { const [pid, i] = t.dataset.discuss.split(':'); const x = AB[pid].assumptions[Number(i)]; const c = (AB[pid].challenge?.items || []).find((y) => y.key === x.key); $('#coach').classList.add('open'); $('#coachInput').value = `I judged this assumption "${x.judgment}": "${x.text}". You argued: "${c?.case || ''}". Make the strongest case for your view, then the strongest case for mine, and say what evidence from these studies would settle it.`; $('#coachInput').focus(); return; }
    if (t.dataset.addJudge) { const pid = t.dataset.addJudge; const name = ($(`[data-judge-name="${pid}"]`).value || '').trim(); if (!name) return toast('Give the colleague a name or pseudonym', true); (F.judges ||= []).push({ id: uid('jg_'), prediction: pid, name, created: new Date().toISOString(), judgments: null }); markDirty(); renderStep(); return; }
    if (t.dataset.copy) { try { await navigator.clipboard.writeText(t.dataset.copy); toast('Link copied'); } catch { prompt('Copy this link', t.dataset.copy); } return; }
    if (t.dataset.delJudge) { if (!confirm('Remove this colleague link (their submitted judgments are deleted too)?')) return; F.judges = (F.judges || []).filter((j) => j.id !== t.dataset.delJudge); markDirty(); renderStep(); return; }
    if (t.dataset.priors) { const pid = t.dataset.priors; const ab = AB[pid]; if (!ab?.assumptions?.length) return toast('Unearth the assumptions first', true); busy(t, true, 'Comparing…'); try { const r = await api('/api/priors-check', { fieldId: F.id, prediction: { id: pid, text: pred(pid).text }, priors: F.inquiry.priors, assumptions: ab.assumptions.map((x) => ({ text: x.text, source: x.source })), tests: testsOf(pid).map((x) => ({ study: short(study(x.study)), design: x.design, result: x.result })) }); ab.priors_check = r.items; ab.priors_check_extra = r.not_mentioned; markDirty(); renderStep(); } catch (err) { toast(err.message, true); busy(t, false); } return; }
    if (t.dataset.assess) { const pid = t.dataset.assess; const pr = pred(pid); const ab = AB[pid]; const judged = (ab?.assumptions || []).filter((x) => x.judgment); if (!judged.length) return toast('Judge at least one assumption first', true); busy(t, true, 'Assessing…'); try { const r = await api('/api/assess', { fieldId: F.id, prediction: { id: pid, text: pr.text, statement: pr.statement }, judgments: judged.map((x) => ({ text: x.text, judgment: x.judgment, source: x.source, relax: x.relax })), tests: testsOf(pid).map((x) => ({ study: short(study(x.study)), design: x.design, result: x.result })) }); DEC[pid] = { ...(DEC[pid] || {}), assessment: r }; markDirty(); renderStep(); } catch (err) { toast(err.message, true); busy(t, false); } return; }
    if (t.dataset.unearth) { const pr = pred(t.dataset.unearth); busy(t, true, 'Reading designs…'); try { const r = await api('/api/assumptions', { fieldId: F.id, prediction: { id: pr.id, text: pr.text, statement: pr.statement }, tests: testsOf(pr.id).map((x) => ({ study: short(study(x.study)), study_label: x.label, design: x.design, result: x.result })), others: F.predictions.filter((x) => x.id !== pr.id && x.status === 'confirmed').map((x) => ({ id: x.id, text: x.text })) }); const mine = (AB[pr.id]?.assumptions || []).filter((a) => a.mine); AB[pr.id] = { ...r, assumptions: [...r.assumptions, ...mine], at: new Date().toISOString() }; markDirty(); renderStep(); } catch (err) { toast(err.message, true); busy(t, false); } }
    if (t.dataset.addA) { const text = prompt('State the assumption in one sentence (what must be true for the results to mean what they claim):'); if (!text) return; const pid = t.dataset.addA; AB[pid] = AB[pid] || { assumptions: [], gaps: [], overlaps: [] }; AB[pid].assumptions.push({ key: uid('m_'), text, source: [], shared_by: 'all', sensitivity: 2, relaxed_by: '', grounding: [], mine: true, judgment: 'questionable' }); markDirty(); api('/api/event', { fieldId: F.id, type: 'judgment', payload: { prediction: pid, kind: 'own_assumption' } }).catch(() => {}); renderStep(); }
    if (t.dataset.card) showCard(t.dataset.card);
  });
  p.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.judge) { const [pid, i] = t.dataset.judge.split(':'); AB[pid].assumptions[Number(i)].judgment = t.value; markDirty(); api('/api/event', { fieldId: F.id, type: 'judgment', payload: { prediction: pid, judgment: t.value, sensitivity: AB[pid].assumptions[Number(i)].sensitivity } }).catch(() => {}); }
    if (t.name?.startsWith('dec-')) { const pid = t.name.slice(4); DEC[pid] = { ...(DEC[pid] || {}), choice: t.value, at: new Date().toISOString() }; markDirty(); api('/api/event', { fieldId: F.id, type: 'decision', payload: { prediction: pid, choice: t.value } }).catch(() => {}); renderStep(); }
  });
  p.addEventListener('input', (e) => { const t = e.target; if (t.dataset.jnote) { const [pid, i] = t.dataset.jnote.split(':'); AB[pid].assumptions[Number(i)].note = t.value; markDirty(); } if (t.dataset.dreason) { DEC[t.dataset.dreason] = { ...(DEC[t.dataset.dreason] || {}), reason: t.value }; markDirty(); } });
}

/* 1 CORPUS */
// Turn a free-text search line into the two term boxes when it is a simple OR list; otherwise keep it as a raw query.
function splitTerms(s) {
  s = String(s || '').trim(); if (!s) return { g1: '', g2: '', q: '' };
  if (/\bAND\b|\(|\)|\bNOT\b/i.test(s)) {
    const m = /^(.*?)\s+AND\s+(.*)$/is.exec(s);
    if (m && !/\bAND\b|\bNOT\b/i.test(m[2])) { const strip = (t) => t.replace(/[()]/g, '').split(/\s+OR\s+/i).map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean).join('\n'); return { g1: strip(m[1]), g2: strip(m[2]), q: '' }; }
    return { g1: '', g2: '', q: s };
  }
  return { g1: s.split(/\s+OR\s+|\n/i).map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean).join('\n'), g2: '', q: '' };
}
function renderCorpus(p) {
  const core = F.studies.filter((s) => s.core).length;
  const prefill = splitTerms(sessionStorage.getItem('cm.prefillQuery') || F.inquiry?.terms || '');
  p.innerHTML = `
  <h2>1. Bound the field and choose the core studies</h2>
  <div class="intro">Build a corpus, then mark the <strong>core empirical studies</strong>: the ones whose predictions and designs the map will cover. Heuristics from the team: the seminal studies, the most recent ones, and those with a rising citation trajectory; reviews and conceptual papers are useful for finding predictions but are flagged, because the map is built from empirical tests. <em>Cites/yr</em> adjusts citations for age; <em>local</em> counts citations from within the corpus (bibliographic coupling).</div>
  <div class="grid2">
    <div class="card"><h3>Search OpenAlex</h3>
      <form id="oa">
      <label>Terms for the first construct <span class="muted">(any of these; one per line or separated by commas)</span><textarea name="g1" rows="2" placeholder="CEO narcissism&#10;narcissistic CEO">${esc(prefill.g1)}</textarea></label>
      <label>Terms for the second construct or context <span class="muted">(optional; any of these)</span><textarea name="g2" rows="2" placeholder="firm performance&#10;innovation&#10;risk taking">${esc(prefill.g2)}</textarea></label>
      <p class="small muted">Every combination is searched as "first term" AND "second term" and the results are merged, so you do not need parentheses (OpenAlex does not support them).</p>
      <details${prefill.q ? ' open' : ''}><summary class="small">Advanced: raw OpenAlex query</summary><label>Query <span class="muted">(quotes for phrases; AND, OR, NOT; no parentheses)</span><input name="q" placeholder='e.g. greenwashing OR "green washing" OR brownwashing' value="${esc(prefill.q)}"></label><p class="small muted">If filled in, this is used instead of the term boxes.</p></details>
      <div class="row"><label style="flex:1">From year<input name="from" type="number" placeholder="1990"></label><label style="flex:1">To year<input name="to" type="number" placeholder="2026"></label></div>
      <div class="row"><label style="flex:1">Sort by<select name="sort"><option value="cites">Most cited</option><option value="cpy">Most cited per year</option><option value="recent">Most recent</option><option value="relevance">Relevance</option></select></label><label style="flex:1">Results<select name="n"><option value="50">50</option><option value="100" selected>100</option><option value="200">200</option><option value="all">All (up to 3,000)</option></select></label><label style="flex:1">Match terms in<select name="scope"><option value="title_abstract">Title and abstract</option><option value="fulltext">Full text (noisier)</option></select></label></div>
      <button>Search</button></form>
      <div id="oaOut" class="small"></div></div>
    <div class="card"><h3>Upload an export</h3>
      <p class="small muted">Scopus CSV, Web of Science tab-delimited (savedrecs.txt), or BibTeX. Only titles, authors, years, DOIs, venues, citation counts and abstracts are read.</p>
      <input type="file" id="expFile" accept=".csv,.txt,.bib,.tsv">
      <div id="expOut" class="small"></div>
      <h3 style="margin-top:1rem">Add a study by hand</h3>
      <form id="manual" class="row"><input name="title" placeholder="Title (or just a DOI)" style="flex:2"><input name="authors" placeholder="Authors" style="flex:1"><input name="year" placeholder="Year" type="number" style="width:90px"><input name="doi" placeholder="DOI" style="flex:1"><button class="small">Add</button></form>
    </div>
  </div>
  <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Corpus: ${F.studies.length} studies, ${core} core</h3><span class="actions"><button class="small ghost" id="localCites">Compute local citations</button><button class="small ghost" id="sortCites">Sort by citations</button><button class="small ghost" id="sortCpy">Sort by cites/yr</button><button class="small ghost" id="sortYear">Sort by year</button></span></div>
  ${F.studies.length ? `<table><tr><th>Core</th><th>Study</th><th>Year</th><th>Venue</th><th>Cited</th><th>Cites/yr</th><th>Local</th><th></th></tr>${F.studies.map((s) => `<tr class="${s.core ? 'core' : ''}"><td><input type="checkbox" data-core="${s.id}" ${s.core ? 'checked' : ''}></td><td><strong>${esc(s.title)}</strong> ${typeBadge(s)}<br><span class="muted small">${esc(s.authors)}${s.doi ? ` · <a href="https://doi.org/${esc(s.doi)}" target="_blank" rel="noopener">doi</a>` : ''}</span>${s.abstract ? `<details><summary class="small">abstract</summary><span class="small">${esc(s.abstract)}</span></details>` : ''}</td><td>${s.year || ''}</td><td class="small">${esc(s.venue)}</td><td>${s.cited_by ?? ''}</td><td>${s.cites_per_year ?? ''}</td><td>${s.local_cites || 0}</td><td class="actions"><label style="margin:0"><button class="small ghost" onclick="this.nextElementSibling.click()" title="Attach this study's PDF and read it">${s.extraction ? 'Re-read' : 'PDF'}</button><input type="file" accept="application/pdf" hidden data-extract="${s.id}"></label><button class="small ghost" data-rm="${s.id}">×</button></td></tr>`).join('')}</table>` : '<div class="empty-state"><h3>Corpus is empty</h3><p>Search OpenAlex, upload an export, add a study by hand, or add your seed studies from step 0.</p></div>'}</div>
  ${loopBar().replace('Not satisfied?', 'Change of mind?')}`;
  let lastSearch = null;
  $('#oa').addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(e.target); const btn = e.target.querySelector('button'); busy(btn, true, 'Searching…');
    try {
      const all = fd.get('n') === 'all'; const CAP = 3000;
      const terms = (t) => String(t || '').split(/\n|,|;/).map((x) => x.trim()).filter(Boolean);
      const g1 = terms(fd.get('g1')), g2 = terms(fd.get('g2')), raw = String(fd.get('q') || '').trim();
      if (!raw && !g1.length) throw new Error('Enter at least one term for the first construct, or a raw query');
      let results, r;
      if (!raw) {
        lastSearch = { fieldId: F.id, groups: g2.length ? [g1, g2] : [g1], fromYear: fd.get('from') || null, toYear: fd.get('to') || null, sort: fd.get('sort'), scope: fd.get('scope'), maxPerCombo: all ? 1000 : Number(fd.get('n')) || 100 };
        busy(btn, true, `Searching ${g1.length * Math.max(1, g2.length)} combination${g1.length * Math.max(1, g2.length) === 1 ? '' : 's'}…`);
        if (lastSearch.sort === 'cpy') lastSearch.sort = 'cites';
        r = await api('/api/openalex/search', lastSearch); results = r.results; if (fd.get('sort') === 'cpy') results.sort((x, y) => (y.cites_per_year || 0) - (x.cites_per_year || 0));
        const note = `${r.unique.toLocaleString()} unique studies from ${r.queries.length} quer${r.queries.length === 1 ? 'y' : 'ies'} (${r.queries.map((q) => `<code>${esc(q)}</code>`).join(', ')}).`;
        showCandidates($('#oaOut'), results, note, null); return;
      }
      lastSearch = { query: raw, fromYear: fd.get('from') || null, toYear: fd.get('to') || null, perPage: all ? 200 : Number(fd.get('n')) || 100, sort: fd.get('sort'), scope: fd.get('scope'), page: 1 };
      if (lastSearch.sort === 'cpy') lastSearch.sort = 'cites';
      r = await api('/api/openalex/search', lastSearch); results = r.results;
      if (all) { const pages = Math.min(Math.ceil(r.total / 200), CAP / 200); for (let p = 2; p <= pages; p++) { busy(btn, true, `Fetching ${Math.min(p * 200, r.total).toLocaleString()} of ${Math.min(r.total, CAP).toLocaleString()}…`); lastSearch.page = p; const r2 = await api('/api/openalex/search', lastSearch); results = results.concat(r2.results); if (!r2.results.length) break; } }
      if (fd.get('sort') === 'cpy') results.sort((x, y) => (y.cites_per_year || 0) - (x.cites_per_year || 0));
      const note = all ? `${r.total.toLocaleString()} matches in OpenAlex; fetched ${results.length.toLocaleString()}${r.total > CAP ? ` (capped at ${CAP.toLocaleString()}; narrow the query or years to see the rest)` : ''}.` : `${r.total.toLocaleString()} matches in OpenAlex; showing ${results.length}.`;
      showCandidates($('#oaOut'), results, note, results.length < r.total && !all ? async () => { lastSearch.page += 1; const r2 = await api('/api/openalex/search', lastSearch); return r2.results; } : null);
    }
    catch (err) { toast(err.message, true); } finally { busy(btn, false); }
  });
  $('#expFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const text = await f.text(); const r = await fetch('/api/corpus/parse', { method: 'POST', headers: { ...headers(), 'content-type': 'text/plain', 'x-filename': f.name }, body: text }); const j = await r.json(); if (!r.ok) throw new Error(j.error); showCandidates($('#expOut'), j.studies, `${j.studies.length} records read from ${esc(f.name)}.`); }
    catch (err) { toast(err.message, true); }
  });
  $('#manual').addEventListener('submit', async (e) => { e.preventDefault(); const fd = new FormData(e.target); if (!String(fd.get('title') || '').trim() && !String(fd.get('doi') || '').trim()) return toast('Enter a title or a DOI', true); const doiIn = String(fd.get('doi') || '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, ''); F.studies.push({ id: uid('s_'), doi: fd.get('doi') || null, title: fd.get('title'), authors: fd.get('authors'), year: Number(fd.get('year')) || null, venue: '', cited_by: null, local_cites: 0, references: [], source: 'manual', abstract: '', core: true, status: 'core', extraction: null, added: new Date().toISOString() }); markDirty(); const st = F.studies[F.studies.length - 1]; if (doiIn) { st.doi = doiIn; try { const r = await api('/api/openalex/resolve', { dois: [doiIn] }); const rec = r.studies[0]; if (rec) { Object.assign(st, { id: rec.id, title: st.title || rec.title, authors: st.authors || rec.authors, year: st.year || rec.year, venue: st.venue || rec.venue, cited_by: rec.cited_by, cites_per_year: rec.cites_per_year, references: rec.references, abstract: rec.abstract }); markDirty(); toast('Citation filled in from OpenAlex'); } } catch {} } renderStep(); });
  p.addEventListener('change', (e) => { const id = e.target.dataset.core; if (id) { const s = study(id); s.core = e.target.checked; s.status = s.core ? 'core' : 'candidate'; markDirty(); renderStep(); } if (e.target.dataset.extract && e.target.files[0]) { const td = e.target.closest('td'); extractFile(e.target.files[0], e.target.dataset.extract, td); } });
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
  const list = F.studies.filter((s) => s.core || s.extraction);
  p.innerHTML = `<h2>2. Read the core studies</h2>
  <div class="intro">Upload each core study's PDF. The model classifies the paper, extracts its <strong>predictions</strong> (what it set out to test, at the construct level), the <strong>research design</strong> used to test each one, the <strong>result</strong>, and the analytical choices, each with a quote and page. Nothing enters the map until you confirm it in step 3. PDFs are read once and not stored.</div>
  <div class="card"><h3>Add a study directly from a PDF</h3><p class="small muted">If the paper is not in the corpus yet, drop it here: the citation is taken from the paper.</p><div class="drop" id="dropNew">Drop a PDF here or <label style="display:inline;color:var(--accent);cursor:pointer"><u>choose a file</u><input type="file" accept="application/pdf" id="fileNew" hidden></label></div><div id="newOut"></div></div>
  ${list.length ? `<table><tr><th>Core study</th><th>Extraction</th><th></th></tr>${list.map((s) => `<tr><td><strong>${esc(s.title)}</strong> ${typeBadge(s)}<br><span class="muted small">${esc(s.authors)} · ${s.year || ''}</span></td><td class="small">${s.extraction ? `${(s.extraction.predictions || []).length} predictions (${(s.extraction.predictions || []).filter((x) => x.core).length} core) · ${(s.extraction.predictions || []).reduce((n, x) => n + (x.tests || []).length, 0)} tests${(s.extraction.studies || []).length > 1 ? ` in ${s.extraction.studies.length} studies` : ''} · ${(s.extraction.choices || []).length} choices${s.imported ? ' · <span class="status confirmed">imported</span>' : ''}<br><span class="muted">${esc(s.extraction.summary)}</span>` : '<span class="muted">not read yet</span>'}</td><td><label><button class="small" onclick="this.nextElementSibling.click()">${s.extraction ? 'Re-read PDF' : 'Upload PDF'}</button><input type="file" accept="application/pdf" hidden data-extract="${s.id}"></label>${s.extraction && !s.imported ? `<button class="small" data-import="${s.id}">Import to map</button>` : ''}${s.extraction ? `<button class="small ghost" data-view="${s.id}">View</button>` : ''}</td></tr>`).join('')}</table>` : `<div class="empty-state"><h3>No core studies yet</h3><p>Mark studies as core in step 1, or drop a PDF above to add one directly.</p><button class="ghost small" onclick="location.hash='field/${F.id}/corpus'">Go to step 1</button></div>`}`;
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
    else { pid = uid('p_'); added++; F.predictions.push({ id: pid, study: sid, sources: [sid], label: pr.label || null, form: pr.form || null, from_review: !!pr.from_review, text: pr.text, statement: pr.statement || '', x: pr.x, y: pr.y, direction: pr.direction, kind: pr.kind || 'main', core: !!pr.core, core_votes: pr.core ? 1 : 0, builds_on: pr.builds_on || [], quote: pr.quote || '', page: pr.page || null, status: 'ai', merge_note: m?.note || null }); }
    for (const t of (pr.tests || (pr.test ? [pr.test] : []))) { F.tests.push({ id: uid('t_'), prediction: pid, study: sid, label: [pr.label, t.study_label].filter(Boolean).join(' · ') || null, study_label: t.study_label || null, design: { data_source: t.data_source, sample: t.sample, period: t.period, iv_measure: t.iv_measure, dv_measure: t.dv_measure, estimator: t.estimator, controls: t.controls || [], functional_form: t.functional_form, identification: t.identification }, result: { direction: t.result_direction, support: t.support, statistic: t.statistic, quote: t.quote || '', page: t.page || null }, robustness: t.robustness || [], status: 'ai' }); }
  }
  for (const ch of x.choices || []) F.choices.push({ id: uid('h_'), study: sid, key: ch.key, category: ch.category, description: ch.description, options: ch.options || [], alternatives_reported: !!ch.alternatives_reported, quote: ch.quote || '', page: ch.page || null, status: 'ai' });
  s.imported = true; markDirty();
  return { added, merged };
}
function viewExtraction(s) {
  const x = s.extraction;
  modal(`<h3>${esc(x.citation)}</h3><p>${typeBadge(s)} ${esc(x.summary)}${(x.studies || []).length > 1 ? ` <span class="muted small">(${x.studies.length} studies: ${esc(x.studies.join(', '))})</span>` : ''}</p>${(x.predictions || []).map((pr) => `<h4>${pr.core ? '★ ' : ''}${pr.label ? esc(pr.label) + ': ' : ''}${esc(pr.text)} <span class="dim">${esc(pr.kind)}</span> <span class="dim">${esc(pr.form || '')}</span>${pr.from_review ? ' <span class="status candidate">from review</span>' : ''}${pr.form === 'post_hoc' ? ' <span class="status candidate" title="Appears only in the results or discussion; not stated as a prediction beforehand">result, not a prediction?</span>' : ''}</h4><p class="small">${esc(pr.statement)}<br><span class="quote">“${esc(pr.quote)}” (p. ${pr.page})</span></p>${(pr.tests || []).length ? pr.tests.map((t) => `<table><tr><th colspan="2">${esc(t.study_label || 'Test')}</th></tr>${DD().map((d) => `<tr><td class="small"><b>${esc(d.name)}</b></td><td class="small">${esc(Array.isArray(t[d.id]) ? t[d.id].join('; ') : t[d.id] ?? '—')}</td></tr>`).join('')}<tr><td class="small"><b>Result</b></td><td class="small">${esc(t.result_direction)}, ${esc(t.support)}; ${esc(t.statistic || '')}<br><span class="quote">“${esc(t.quote)}” (p. ${t.page})</span></td></tr></table>`).join('') : '<p class="small muted">Not tested empirically in this paper.</p>'}`).join('')}<h4>Analytical choices (${(x.choices || []).length})</h4><table>${(x.choices || []).map((h) => `<tr><td>${esc(h.category)}</td><td>${esc(h.description)}<br><span class="quote">${esc((h.options || []).join(' | '))}</span></td><td class="small">p. ${h.page}</td></tr>`).join('')}</table><menu><button data-close class="ghost">Close</button></menu>`);
}

/* 3 PREDICTIONS */
function renderPredictions(p) {
  const listAll = [...F.predictions].sort((a, b) => (b.core - a.core) || (testsOf(b.id).length - testsOf(a.id).length));
  const list = SHOW_REJECTED ? listAll : listAll.filter((x) => x.status !== 'rejected'); const nRej = listAll.length - list.length;
  p.innerHTML = `<h2>3. Confirm the predictions, then choose the core ones</h2>
  <div class="intro">A prediction is what the authors expected before the data: <strong>X → Y (direction)</strong>, at the construct level. The model proposed each one with a quote; when a later paper tests the same prediction, it was merged here and the count of studies grew. Confirm, edit, merge or reject. Mark as <strong>core</strong> the predictions that recur across studies and that later work builds on: those are the ones worth a multiverse or a replication.</div>
  ${list.length ? `<table><tr><th>Core</th><th>Prediction</th><th>Kind</th><th>Studies</th><th>Evidence</th><th>Status</th></tr>${list.map((pr) => { const ts = testsOf(pr.id); const res = ts.map((t) => t.result?.support).filter(Boolean); const sup = res.filter((r) => r === 'supported').length; return `<tr class="${pr.core ? 'core' : ''}${pr.status === 'rejected' ? ' rejected' : ''}"><td><button class="small ${pr.core ? '' : 'ghost'} corebtn" data-core-p="${pr.id}" title="${pr.core ? 'Core: this prediction will be mapped in steps 4–7. Click to unmark.' : 'Mark as core: the predictions you want to map (steps 4–7). Confirming only says the extraction is correct.'}">${pr.core ? '★ Core' : '☆ Make core'}</button>${pr.core && pr.status === 'ai' ? '<br><span class="small" style="color:var(--warn)">proposed as core: confirm it to use in step 4</span>' : ''}${pr.focus ? `<br><span class="small ${pr.focus === 'core' ? 'ok' : pr.focus === 'outside' ? 'muted' : ''}" title="${esc(pr.focus_reason || '')}">${pr.focus === 'core' ? 'matches your inquiry' : pr.focus === 'related' ? 'related' : 'outside your inquiry'}</span>` : ''}</td><td><strong>${esc(pr.text)}</strong><br><span class="small">${esc(pr.statement || '')}</span><br><span class="small muted">first in ${esc(short(study(pr.study)))}${pr.builds_on?.length ? ` · builds on ${esc(pr.builds_on.join('; '))}` : ''}${pr.merge_note && pr.merge_note !== 'new' && pr.merge_note !== 'first in map' ? ` · ${esc(pr.merge_note)}` : ''}</span></td><td><span class="dim">${esc(pr.kind)}</span><br><span class="small muted">${esc(pr.form ? pr.form.replace('_', ' ') : '')}${pr.from_review ? ' · from review' : ''}${pr.form === 'post_hoc' ? ' · <span style="color:var(--warn)">reported as a result, not stated as a prediction</span>' : ''}</span></td><td>${ts.length}${res.length ? `<br><span class="small muted">${sup} supported</span>` : ''}</td><td class="quote">“${esc(pr.quote)}” (p. ${pr.page ?? '?'})</td><td>${statusBtns('prediction', pr.id, pr.status)}<br><span class="actions" style="margin-top:.3rem"><button class="small ghost" data-merge="${pr.id}">Merge into…</button></span></td></tr>`; }).join('')}</table>
  <p class="actions" style="margin-top:.6rem"><button class="small ghost" id="confirmAllP">Confirm all proposed</button><button class="small ghost" id="addP">Add a prediction from my own reading</button><button class="small ghost" id="suggestCore" title="The tool reads your step-0 inquiry and says which predictions it is about; you decide">Which of these match my inquiry?</button>${F.predictions.some((x) => x.focus === 'outside' && x.status !== 'rejected' && !x.core) ? '<button class="small ghost" id="rejectOutside">Reject the ones outside my inquiry</button>' : ''}${nRej ? `<button class="small ghost" id="showRejected">${SHOW_REJECTED ? 'Hide' : 'Show'} ${nRej} rejected</button>` : ''}</p>${loopBar()}` : `<div class="empty-state"><h3>No predictions yet</h3><p>Upload a PDF in step 2 and click “Import to map”.</p><button class="ghost small" onclick="location.hash='field/${F.id}/studies'">Go to step 2</button></div>`}`;
  p.addEventListener('click', async (e) => {
    const id = e.target.dataset.coreP; if (id) { const pr = pred(id); pr.core = !pr.core; if (pr.core && pr.status === 'ai') pr.status = 'confirmed'; markDirty(); renderStep(); return; }
    if (e.target.id === 'suggestCore') { if (!F.inquiry?.statement) return toast('State your inquiry in step 0 first', true); busy(e.target, true, 'Reading your inquiry…'); try { const cand = F.predictions.filter((x) => x.status !== 'rejected'); const r = await api('/api/suggest-core', { fieldId: F.id, inquiry: F.inquiry, predictions: cand.map((x) => ({ id: x.id, text: x.text, statement: x.statement, n: testsOf(x.id).length })) }); let k = 0; for (const it of r.items) { const pr = pred(it.id); if (!pr) continue; pr.focus = it.verdict; pr.focus_reason = it.reason; if (it.verdict === 'core') k++; } markDirty(); toast(`${k} prediction${k === 1 ? '' : 's'} match your inquiry; the rest are marked related or outside. Nothing was changed: mark core or reject as you see fit.`); renderStep(); } catch (err) { toast(err.message, true); } finally { busy(e.target, false); } }
    if (e.target.id === 'rejectOutside') { let k = 0; for (const pr of F.predictions) if (pr.focus === 'outside' && pr.status !== 'rejected' && !pr.core) { pr.status = 'rejected'; k++; } markDirty(); toast(`${k} rejected (kept in the record)`); renderStep(); }
    if (e.target.id === 'showRejected') { SHOW_REJECTED = !SHOW_REJECTED; renderStep(); }
  });
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
  <div class="intro">This is the first half of the field's <strong>epistemic map</strong>, as the literature has drawn it (step 7 completes it with the alternatives and the teams): for each core prediction, the rows are the nine <strong>research-design dimensions</strong> (the assumption sets, in King, Goldfarb &amp; Simcoe's 2021 terms) and the cells list the options used across studies, with the result each study found under each. A dimension with several options and mixed results is a design decision that matters: an input to a multiverse, and a candidate for the next test. Confirm or reject the tests the model extracted; edit them if the paper says otherwise.</div>
  ${core.length ? core.map((pr) => { const ts = testsOf(pr.id); const varying = DD().filter((d) => designRange(pr.id, d.id).length > 1); return `<div class="card"><div class="row" style="justify-content:space-between"><div><strong>★ ${esc(pr.text)}</strong><br><span class="small muted">${ts.length} test${ts.length === 1 ? '' : 's'} in ${new Set(ts.map((t) => t.study)).size} stud${new Set(ts.map((t) => t.study)).size === 1 ? 'y' : 'ies'} · ${ts.filter((t) => t.result?.support === 'supported').length} supported, ${ts.filter((t) => t.result?.support === 'not supported').length} not, ${ts.filter((t) => t.result?.support === 'partly').length} partly · design decisions that vary: ${varying.length ? varying.map((d) => esc(d.name)).join(', ') : 'none yet'}</span></div><span class="small muted" style="flex:1 1 180px;text-align:right">Next: judge the assumptions (step 5) → multiverse (steps 7–8) or a new study (step 9)</span></div>
    <table style="margin-top:.6rem"><tr><th>Dimension</th><th>Options used across studies (study: result)</th></tr>${DD().map((d) => { const r = designRange(pr.id, d.id); return `<tr><td><b>${esc(d.name)}</b><br><span class="small muted">${esc(d.question)}</span></td><td class="cell ${r.length > 1 ? 'partly' : r.length ? 'covered' : 'none'}" style="text-align:left">${r.length ? r.map((o) => `<div><strong>${esc(o.value)}</strong> <span class="small muted">${o.tests.map((t) => `${esc(short(study(t.study)))}${t.study_label ? ' ' + esc(t.study_label) : ''}: ${esc(t.result?.direction || '?')}/${esc(t.result?.support || '?')}`).join('; ')}</span></div>`).join('') : '<span class="muted small">not reported</span>'}${r.length > 1 ? ' <span class="small" style="color:var(--warn)">varies across studies</span>' : ''}</td></tr>`; }).join('')}</table>
    <details style="margin-top:.5rem" data-open="${pr.id}" ${OPEN_TESTS.has(pr.id) ? 'open' : ''}><summary>Tests of this prediction (${ts.length}) — confirm or edit</summary><table>${F.tests.filter((t) => t.prediction === pr.id).map((t) => `<tr><td><b>${esc(short(study(t.study)))}</b>${t.label ? ` ${esc(t.label)}` : ''}<br><span class="small muted">${esc(t.design?.dv_measure || '')} on ${esc(t.design?.iv_measure || '')}; ${esc(t.design?.estimator || '')}</span></td><td class="small">${esc(t.result?.direction || '')}, ${esc(t.result?.support || '')}; ${esc(t.result?.statistic || '')}<br><span class="quote">“${esc(t.result?.quote || '')}” (p. ${t.result?.page ?? '?'})</span></td><td>${statusBtns('test', t.id, t.status)}</td></tr>`).join('')}</table></details></div>`; }).join('') : `<div class="empty-state"><h3>No core predictions confirmed</h3>${F.predictions.filter((x) => x.core && x.status === 'ai').length ? `<p>${F.predictions.filter((x) => x.core && x.status === 'ai').length} prediction${F.predictions.filter((x) => x.core && x.status === 'ai').length === 1 ? ' is' : 's are'} marked core but not yet confirmed as correctly extracted.</p><button class="small" id="confirmCore">Confirm the core predictions</button> ` : '<p>In step 3, confirm predictions and mark the core ones.</p>'}<button class="ghost small" onclick="location.hash='field/${F.id}/predictions'">Go to step 3</button></div>`}
  ${others.length ? `<div class="card"><h3>Other confirmed predictions (${others.length})</h3><p class="small muted">Not marked core. ${others.map((x) => `${esc(x.text)} (${testsOf(x.id).length})`).join(' · ')}</p></div>` : ''}
  ${loopBar()}`;
  p.addEventListener('toggle', (e) => { const d = e.target; if (d.dataset?.open) { if (d.open) OPEN_TESTS.add(d.dataset.open); else OPEN_TESTS.delete(d.dataset.open); } }, true);
  p.addEventListener('click', (e) => { if (e.target.id === 'confirmCore') { for (const x of F.predictions) if (x.core && x.status === 'ai') x.status = 'confirmed'; markDirty(); renderStep(); return; } const { act, kind, id } = e.target.dataset; if (kind !== 'test') return; const t = F.tests.find((x) => x.id === id); if (act === 'edit') return editTest(t); t.status = act === 'confirm' ? 'confirmed' : 'rejected'; markDirty(); renderStep(); });
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
  p.innerHTML = `<h2>6. Space of analytical choices</h2>
  <div class="intro">The analytical choices the model found in each paper form the <em>choice space</em> for a multiverse. For the benchmark, load or paste a reference list (the ${refLink('berchicci2022')} window of model uncertainty is built in, one choice per line as <code>category | description</code>), then align the two lists. Found, missed and added are the benchmark result; you can override every match. <strong>What confirming does:</strong> confirmed choices are the forking paths of this literature; they feed the choice-space export and the alternatives the tool proposes in step 7, and they are the raw material for the analytical dimensions of the multiverse. Rejected ones are kept but ignored. Confirmed choices can also become this field's own reference list (button below), so the benchmark compares new papers against what you have verified.</div>
  <div class="grid2"><div class="card"><h3>Reference list (${ref.length})</h3><textarea id="refText" placeholder="sample | Exclude financial firms&#10;controls | Firm size (log assets)&#10;model | Firm fixed effects vs random effects" style="min-height:140px">${esc(ref.map((r) => `${r.category} | ${r.description}`).join('\n'))}</textarea><p class="actions"><button class="small" id="saveRef">Save list</button><button class="small ghost" id="loadBench">Load Berchicci &amp; King (2022) reference</button><button class="small ghost" id="refFromChoices" title="Turns the choices you confirmed below into the reference list for this field, one line per distinct choice">Use my confirmed choices as the reference</button><button class="small ghost" id="runCompare" ${ref.length && F.choices.length ? '' : 'disabled'}>Align with AI choices</button></p></div>
  <div class="card"><h3>Benchmark: found, missed, added</h3><p class="small muted">The benchmark asks how much of a published reference list of analytical choices the tool recovered from the papers on its own: <em>found</em> (in the reference and in the tool's list), <em>missed</em> (in the reference only) and <em>added</em> (found by the tool but not in the reference). It is the accuracy check reported in the proposal (demonstrator D2).</p>${F.matches.length ? (() => { const found = F.matches.filter((m) => m.a?.length).length; const added = F.choices.filter((h) => h.status !== 'rejected' && !matched.has(h.key + '@' + h.study)).length; return `<p><strong>${found}/${ref.length}</strong> reference choices found by the AI (${Math.round(100 * found / Math.max(1, ref.length))}%), <strong>${ref.length - found}</strong> missed, <strong>${added}</strong> additional choices proposed.</p><table><tr><th>Reference choice</th><th>Matched AI choice(s)</th><th>Conf.</th></tr>${F.matches.map((m) => { const r = ref.find((x) => x.key === m.r) || {}; return `<tr><td>[${esc(r.category)}] ${esc(r.description)}</td><td>${(m.a || []).map((k) => { const [key, sid] = k.split('@'); const h = F.choices.find((x) => x.key === key && x.study === sid); return h ? `${esc(h.description)} <span class="muted">(${esc(short(study(sid)))})</span>` : esc(k); }).join('<br>') || '<span style="color:var(--bad)">missed</span>'}${m.note ? `<br><span class="small muted">${esc(m.note)}</span>` : ''}</td><td>${esc(m.confidence || '')}</td></tr>`; }).join('')}</table>`; })() : '<p class="muted">Nothing to show yet: save a reference list on the left (the built-in Berchicci &amp; King list, or your confirmed choices), then click “Align with AI choices”.</p>'}</div></div>
  ${F.choices.length ? (() => {
    const byCat = {}; for (const h of F.choices) (byCat[h.category || 'other'] ||= []).push(h);
    const studies = [...new Set(F.choices.map((h) => h.study))];
    const cats = Object.keys(byCat).sort((x, y) => byCat[y].length - byCat[x].length);
    const byView = VIEW_CHOICES === 'study';
    return `<div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Choices across studies <span class="small muted">· ${F.choices.length} choices in ${studies.length} stud${studies.length === 1 ? 'y' : 'ies'}, ${cats.length} categories</span></h3><span class="actions"><button class="small ${byView ? 'ghost' : ''}" data-view-choices="category">By category</button><button class="small ${byView ? '' : 'ghost'}" data-view-choices="study">By study</button></span></div>
    <p class="small muted">${byView ? 'Each study\'s choices, as extracted.' : 'Each row is one category of analytical decision; the columns show what each study chose, so differences between studies are visible at a glance. Where a column is empty, the study did not report a choice in that category.'}</p>
    ${byView ? Object.entries(bySt).map(([sid, list]) => `<h4 style="margin:.8rem 0 .3rem">${esc(short(study(sid)))} <span class="small muted">${esc(study(sid)?.title || '')}</span></h4><table><tr><th>Category</th><th>Choice</th><th>Options</th><th>Alt. reported</th><th>Evidence</th><th>Status</th></tr>${list.map((h) => `<tr><td>${esc(h.category)}</td><td>${esc(h.description)}${matched.has(h.key + '@' + sid) ? ' <span class="status confirmed">in reference</span>' : ''}</td><td class="small">${esc((h.options || []).join(' | '))}</td><td>${h.alternatives_reported ? 'yes' : 'no'}</td><td class="quote">“${esc(h.quote)}” (p. ${h.page ?? '?'})</td><td>${statusBtns('choice', h.id, h.status)}</td></tr>`).join('')}</table>`).join('')
      : (studies.length > 4 ? `<p class="small muted">${studies.length} studies: each table scrolls sideways (shift + mouse wheel, or drag the bar under it). Columns are the studies in corpus order.</p>` : '') + cats.map((cat) => `<h4 style="margin:.9rem 0 .3rem">${esc(cat)} <span class="small muted">· ${byCat[cat].length} choice${byCat[cat].length === 1 ? '' : 's'}</span></h4><div class="hscroll"><table class="matrix choices" style="min-width:${Math.max(600, studies.length * 190)}px"><tr>${studies.map((sid) => `<th>${esc(short(study(sid)))}</th>`).join('')}</tr><tr>${studies.map((sid) => { const hs = byCat[cat].filter((h) => h.study === sid && h.status !== 'rejected'); return `<td class="small ${hs.length ? '' : 'muted'}" style="vertical-align:top">${hs.length ? hs.map((h) => `<div class="choice-cell" title="“${esc(h.quote)}” (p. ${h.page ?? '?'})">${esc(h.description)}${(h.options || []).length ? `<br><span class="muted">${esc(h.options.join(' | '))}</span>` : ''}${h.status === 'ai' ? ` <span class="status ai" title="proposed by the model">ai</span>` : ' <span class="status confirmed" title="confirmed">✓</span>'} <span class="actions">${h.status === 'ai' ? `<button class="x" data-act="confirm" data-kind="choice" data-id="${h.id}" title="confirm">✓</button><button class="x" data-act="reject" data-kind="choice" data-id="${h.id}" title="reject">✗</button>` : ''}</span></div>`).join('') : '—'}</td>`; }).join('')}</tr></table></div>`).join('')}</div>`;
  })() : `<div class="empty-state"><h3>No analytical choices yet</h3><p>Choices are collected when you import an extraction in step 2.</p></div>`}`;
  $('#saveRef').addEventListener('click', () => { F.reference = $('#refText').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => { const [c, ...d] = l.split('|'); return { key: `r${i + 1}`, category: (d.length ? c : 'other').trim(), description: (d.length ? d.join('|') : c).trim() }; }); markDirty(); renderStep(); });
  $('#refFromChoices').addEventListener('click', () => { const seen = new Set(); const lines = []; for (const h of F.choices) { if (h.status !== 'confirmed') continue; const k = `${h.category}|${h.description}`.toLowerCase(); if (seen.has(k)) continue; seen.add(k); lines.push(`${h.category || 'other'} | ${h.description}`); } if (!lines.length) return toast('Confirm some choices first', true); $('#refText').value = lines.join('\n'); toast(`${lines.length} confirmed choices written to the reference list. Click Save list.`); });
  $('#loadBench').addEventListener('click', async () => { const b = (await api('/api/benchmarks'))[0]; $('#refText').value = b.reference.map((r) => `${r.category} | ${r.description}`).join('\n'); toast(`${b.reference.length} reference choices loaded from ${b.name.split(':')[0]}. Click Save list.`); });
  $('#runCompare').addEventListener('click', async (e) => {
    busy(e.target, true, 'Aligning…');
    try { const A = F.choices.filter((h) => h.status !== 'rejected').map((h) => ({ key: `${h.key}@${h.study}`, category: h.category, description: h.description, options: h.options })); const r = await api('/api/compare', { fieldId: F.id, reference: F.reference, choices: A }); F.matches = r.matches || []; markDirty(); renderStep(); }
    catch (err) { toast(err.message, true); busy(e.target, false); }
  });
  p.addEventListener('click', (e) => { const v = e.target.dataset.viewChoices; if (v) { VIEW_CHOICES = v; renderStep(); } });
  p.addEventListener('click', (e) => { const { act, kind, id } = e.target.dataset; if (kind !== 'choice') return; const h = F.choices.find((x) => x.id === id); if (act === 'edit') { modal(`<h3>Edit choice</h3><form id="ef"><label>Category<input name="category" value="${esc(h.category)}"></label><label>Description<textarea name="description">${esc(h.description)}</textarea></label><label>Options (one per line)<textarea name="options">${esc((h.options || []).join('\n'))}</textarea></label><menu><button type="button" data-close class="ghost">Cancel</button><button>Save</button></menu></form>`, (b) => $('#ef', b).addEventListener('submit', (ev) => { ev.preventDefault(); const fd = new FormData(ev.target); h.category = fd.get('category'); h.description = fd.get('description'); h.options = fd.get('options').split('\n').map((x) => x.trim()).filter(Boolean); if (h.status === 'ai') h.status = 'confirmed'; markDirty(); $('#modal').close(); renderStep(); })); return; } h.status = act === 'confirm' ? 'confirmed' : 'rejected'; markDirty(); renderStep(); });
}


/* route banner: what the step-5 decisions imply for this step */
const ROUTE_WORD = { multiverse: 'Multiverse', replication: 'Replication', both: 'Both (replication, then multiverse)', newdesign: 'New design', stop: 'Stop' };
function routeBanner(step) {
  const DEC = F.decisions || {}; const core = F.predictions.filter((x) => x.status === 'confirmed' && x.core);
  const rows = core.map((pr) => ({ pr, d: DEC[pr.id]?.choice })).filter((x) => x.d);
  if (!rows.length) return `<div class="note small">No decision recorded yet in step 5. The multiverse is one of the routes; decide there first if you want the tool to say which steps apply.</div>`;
  const applies = (d) => step === 'export' ? true : ['multiverse', 'both'].includes(d);
  return `<div class="note small"><strong>Your routes from step 5:</strong> ${rows.map(({ pr, d }) => `${esc(pr.text)} → <strong>${ROUTE_WORD[d] || d}</strong>${applies(d) ? '' : (d === 'newdesign' ? ' (this step is optional: a new design is recorded as a brief; step 9 carries it to the Navigator and the export)' : d === 'replication' ? ' (this step is optional: the replication is planned from step 9 in the Navigator)' : ' (nothing further)')}`).join(' · ')}</div>`;
}

/* 7 EPISTEMIC MAP & TEAMS: assumption space, legend, specifications, allocation, collected results */
const SPEC_CAP = 10000;
function spaceFor(pid) {
  const SP = F.space || (F.space = {}); const sp = SP[pid] || (SP[pid] = { dims: {}, stat: 'Coefficient on X (or marginal effect), its standard error, and N', note: '' });
  for (const d of DD()) {
    const r = designRange(pid, d.id); const used = r.map((o) => o.value);
    const cur = sp.dims[d.id] || (sp.dims[d.id] = { include: r.length > 1, options: [], own: [] });
    cur.options = [...new Set([...used, ...(cur.own || [])])].filter((o) => !(cur.excluded || []).includes(o));
  }
  return sp;
}
function specsFor(pid) {
  const sp = spaceFor(pid); const dims = DD().filter((d) => sp.dims[d.id].include && sp.dims[d.id].options.length);
  let n = 1; for (const d of dims) n *= sp.dims[d.id].options.length;
  if (n > SPEC_CAP) return { dims, n, specs: null };
  let combos = [[]]; for (const d of dims) combos = combos.flatMap((c) => sp.dims[d.id].options.map((o, i) => [...c, { d: d.id, o, i }]));
  const specs = combos.map((c) => { const spec = Object.fromEntries(c.map((z) => [z.d, z.o])); const id = `${pid}:${c.map((z) => z.i).join('.')}`; const prior = testsOf(pid).filter((t) => dims.every((d) => { let v = t.design?.[d.id]; if (Array.isArray(v)) v = v.join(', '); return String(v || '').trim() === spec[d.id]; })); return { id, spec, prior }; });
  return { dims, n, specs };
}
function seededShuffle(arr, seed) { let s = Number(seed) || 1; const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor((s / 233280) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function allocate(pid, mode, seed) {
  const teams = F.teams || []; if (!teams.length) throw new Error('Add at least one team first');
  const { dims, specs } = specsFor(pid); if (!specs) throw new Error(`Too many specifications (> ${SPEC_CAP}); drop a dimension or some options first`);
  const A = {}; for (const t of teams) A[t.id] = [];
  if (mode === 'all') for (const t of teams) A[t.id] = specs.map((s) => s.id);
  else if (mode === 'split') { const order = seededShuffle(specs.map((s) => s.id), seed); order.forEach((id, i) => A[teams[i % teams.length].id].push(id)); }
  else if (mode === 'fork') { const vary = seededShuffle(dims, seed); teams.forEach((t, i) => { const d = vary[i % vary.length]; if (!d) return; const base = specs[0]; A[t.id] = specs.filter((s) => dims.every((e) => e.id === d.id || s.spec[e.id] === base.spec[e.id])).map((s) => s.id); t.fork = d.id; }); }
  else if (mode === 'free') for (const t of teams) A[t.id] = [];
  F.allocation = { prediction: pid, mode, seed: Number(seed) || 1, at: new Date().toISOString(), assignments: A };
  markDirty(); api('/api/event', { fieldId: F.id, type: 'allocation', payload: { prediction: pid, mode, teams: teams.length, specs: specs.length } }).catch(() => {});
}
function teamLink(t) { return `${location.origin}${location.pathname}#field/${F.id}/team/${t.id}`; }
function specCurveSvg(runs) {
  const rs = runs.filter((r) => Number.isFinite(Number(r.estimate))).map((r) => ({ ...r, e: Number(r.estimate), s: Number(r.se) || 0 })).sort((a, b) => a.e - b.e);
  if (!rs.length) return '<p class="muted small">No numeric estimates yet. The curve appears as teams submit results.</p>';
  const W = 720, H = 220, L = 50, R = 20, T = 14, B = 30; const lo = Math.min(0, ...rs.map((r) => r.e - 1.96 * r.s)), hi = Math.max(0, ...rs.map((r) => r.e + 1.96 * r.s)); const y = (v) => T + (H - T - B) * (1 - (v - lo) / ((hi - lo) || 1)); const x = (i) => L + (W - L - R) * ((i + 0.5) / rs.length);
  const teams = [...new Set(rs.map((r) => r.team))]; const col = (t) => ['#2F80ED', '#9B51E0', '#27AE60', '#F2994A', '#EB5757', '#2D9CDB', '#6FCF97', '#BB6BD9'][teams.indexOf(t) % 8];
  return `<svg class="speccurve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Specification curve: estimates sorted by size with 95% intervals"><line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="#999" stroke-dasharray="4 3"/><text x="${L - 6}" y="${y(0) + 4}" font-size="10" text-anchor="end">0</text><text x="${L - 6}" y="${y(hi) + 4}" font-size="10" text-anchor="end">${hi.toPrecision(2)}</text><text x="${L - 6}" y="${y(lo) + 4}" font-size="10" text-anchor="end">${lo.toPrecision(2)}</text>${rs.map((r, i) => `<g><line x1="${x(i)}" x2="${x(i)}" y1="${y(r.e - 1.96 * r.s)}" y2="${y(r.e + 1.96 * r.s)}" stroke="${col(r.team)}" stroke-opacity=".5"/><circle cx="${x(i)}" cy="${y(r.e)}" r="3.5" fill="${col(r.team)}"><title>${esc(r.spec_id)} · ${esc(r.estimate)} (SE ${esc(r.se || '?')}) · ${esc((F.teams.find((t) => t.id === r.team) || {}).name || r.team)}</title></circle></g>`).join('')}<text x="${(L + W - R) / 2}" y="${H - 8}" font-size="10" text-anchor="middle">${rs.length} specification${rs.length === 1 ? '' : 's'}, sorted by estimate · ${rs.filter((r) => r.e > 0).length} positive, ${rs.filter((r) => r.e < 0).length} negative · ${rs.filter((r) => Math.abs(r.e) > 1.96 * r.s && r.s).length} with |z| > 1.96</text>${teams.map((t, i) => `<rect x="${L + i * 120}" y="2" width="10" height="10" fill="${col(t)}"/><text x="${L + 14 + i * 120}" y="11" font-size="10">${esc((F.teams.find((q) => q.id === t) || {}).name || t)}</text>`).join('')}</svg>`;
}
function renderMultiverse(p) {
  const core = F.predictions.filter((x) => x.status === 'confirmed' && x.core);
  const AB = F.assumptions_by_prediction || {}; const teams = F.teams || (F.teams = []); const AL = F.allocation || {};
  const curPid = AL.prediction && core.some((c) => c.id === AL.prediction) ? AL.prediction : core[0]?.id;
  p.innerHTML = `<h2>7. Multiverse: the assumption space and its legend</h2>
  <div class="intro">An <strong>epistemic map</strong> is a correspondence between sets of assumptions and the evidence obtained under each (${refLink('king2021')}; applied to a replication by ${refLink('goldfarb2021')}). Step 4 showed the assumption sets the literature has already used; step 5 recorded your judgment of them. Here you complete the map: fix the <strong>assumption space</strong> for a core prediction (which design dimensions vary, with which options, including alternatives no study has used), read the <strong>legend</strong> (where each prior study sits; which assumptions you judged questionable), and turn the space into a list of <strong>specifications</strong>: the plan for a multiverse you can run yourself (download it below) or hand to analyst teams in step 8. The researcher is the cartographer; the map stays neutral and the judgments stay in the legend.</div>
  ${routeBanner('multiverse')}
  ${core.length ? `<div class="card"><label>Core prediction to map<select id="mvPred">${core.map((c) => `<option value="${c.id}" ${c.id === curPid ? 'selected' : ''}>${esc(c.text)}</option>`).join('')}</select></label></div>` + mvBody(curPid) : `<div class="empty-state"><h3>No core predictions yet</h3><p>Confirm predictions in step 3 and mark the core ones; the design map (step 4) and the judgments (step 5) feed this step.</p></div>`}
  ${loopBar()}`;
  $('#mvPred')?.addEventListener('change', (e) => { F.allocation = { ...(F.allocation || {}), prediction: e.target.value }; markDirty(); renderStep(); });
  if (core.length && (!F.allocation || F.allocation.prediction !== curPid)) { F.allocation = { ...(F.allocation || {}), prediction: curPid }; markDirty(); }
  p.addEventListener('click', async (e) => {
    const t = e.target; const pid = $('#mvPred')?.value; if (!pid) return;
    const sp = spaceFor(pid);
    if (t.dataset.addOpt) { const d = t.dataset.addOpt; const v = ($(`[data-opt-in="${d}"]`)?.value || '').trim(); if (!v) return; sp.dims[d].own = [...new Set([...(sp.dims[d].own || []), v])]; sp.dims[d].include = true; markDirty(); renderStep(); }
    if (t.dataset.dropOpt) { const [d, v] = [t.dataset.dropOpt, t.dataset.v]; sp.dims[d].own = (sp.dims[d].own || []).filter((x) => x !== v); if (designRange(pid, d).some((o) => o.value === v)) sp.dims[d].excluded = [...new Set([...(sp.dims[d].excluded || []), v])]; markDirty(); renderStep(); }
    if (t.id === 'suggestAlt') { busy(t, true, 'Reading the map…'); try { const pr = pred(pid); const AB = (F.assumptions_by_prediction || {})[pid]; const r = await api('/api/alternatives', { fieldId: F.id, prediction: { id: pid, text: pr.text, statement: pr.statement }, dims: DD().map((d) => ({ id: d.id, name: d.name, options: sp.dims[d.id].options })), judgments: (AB?.assumptions || []).filter((x) => x.judgment).map((x) => ({ text: x.text, judgment: x.judgment })), gaps: AB?.gaps || [] }); sp.suggested = r.alternatives; markDirty(); renderStep(); } catch (err) { toast(err.message, true); busy(t, false); } }
    if (t.dataset.takeAlt) { const s_ = sp.suggested[Number(t.dataset.takeAlt)]; if (s_ && sp.dims[s_.dim]) { sp.dims[s_.dim].own = [...new Set([...(sp.dims[s_.dim].own || []), s_.option])]; sp.dims[s_.dim].include = true; sp.suggested.splice(Number(t.dataset.takeAlt), 1); markDirty(); renderStep(); } }
    if (t.id === 'addTeam') { const name = ($('#teamName').value || '').trim(); if (!name) return; teams.push({ id: uid('tm_'), name, members: ($('#teamMembers').value || '').trim(), created: new Date().toISOString() }); markDirty(); renderStep(); }
    if (t.dataset.delTeam) { const id = t.dataset.delTeam; if (!confirm('Remove this team? Its submitted results are kept.')) return; F.teams = teams.filter((x) => x.id !== id); if (F.allocation?.assignments) delete F.allocation.assignments[id]; markDirty(); renderStep(); }
    if (t.dataset.copy) { try { await navigator.clipboard.writeText(t.dataset.copy); toast('Link copied'); } catch { prompt('Copy this link', t.dataset.copy); } }
    if (t.id === 'allocate') { try { allocate(pid, $('#allocMode').value, $('#allocSeed').value); toast('Specifications allocated'); renderStep(); } catch (err) { toast(err.message, true); } }
    if (t.dataset.delRun) { if (!confirm('Delete this submitted result?')) return; F.runs = (F.runs || []).filter((r) => r.id !== t.dataset.delRun); markDirty(); renderStep(); }
  });
  p.addEventListener('change', (e) => {
    const t = e.target; const pid = $('#mvPred')?.value; if (!pid) return; const sp = spaceFor(pid);
    if (t.dataset.inc) { sp.dims[t.dataset.inc].include = t.checked; markDirty(); renderStep(); }
    if (t.id === 'mvStat') { sp.stat = t.value; markDirty(); }
    if (t.id === 'mvStatSel') { if (!t.value.startsWith('Other')) { sp.stat = t.value; $('#mvStat').value = t.value; } markDirty(); }
  });
}
function mvBody(pid) {
  const sp = spaceFor(pid); const { dims, n, specs } = specsFor(pid); const AB = (F.assumptions_by_prediction || {})[pid]; const AL = F.allocation || {}; const teams = F.teams || [];
  const judged = (AB?.assumptions || []).filter((a) => a.judgment);
  const runs = (F.runs || []).filter((r) => r.prediction === pid);
  const assigned = AL.prediction === pid ? AL.assignments || {} : {};
  return `<div class="card"><h3>1 · Assumption space <span class="small muted">— which decisions vary, and with which options</span></h3>
    <table><tr><th></th><th>Design dimension</th><th>Options (from the studies, plus your alternatives)</th></tr>${DD().map((d) => { const c = sp.dims[d.id]; const used = new Set(designRange(pid, d.id).map((o) => o.value)); return `<tr><td><input type="checkbox" data-inc="${d.id}" ${c.include ? 'checked' : ''} aria-label="Vary ${esc(d.name)}"></td><td><b>${esc(d.name)}</b><br><span class="small muted">${esc(d.question)}</span></td><td>${c.options.map((o) => `<span class="opt ${used.has(o) ? 'used' : 'alt'}" title="${used.has(o) ? 'used by a prior study' : 'alternative no study has used'}">${esc(o)} <button class="x" data-drop-opt="${d.id}" data-v="${esc(o)}" aria-label="remove" title="${used.has(o) ? 'Leave this option out of the map (the study record is unchanged)' : 'Remove this alternative'}">×</button></span>`).join(' ') || '<span class="muted small">no options yet</span>'}<div class="row" style="margin-top:.3rem"><input data-opt-in="${d.id}" placeholder="Add an alternative no study has used" style="flex:1"><button class="small ghost" data-add-opt="${d.id}">Add</button></div></td></tr>`; }).join('')}</table>
    ${(() => { const v = ((F.assumptions_by_prediction || {})[pid]?.assumptions || []).filter((x) => x.judgment === 'violated'); return v.length >= 2 ? `<div class="note" style="margin:.5rem 0"><strong>Caution:</strong> you judged ${v.length} assumptions <em>violated</em>. A multiverse on existing data varies analytical choices; it cannot repair a design flaw shared by all the studies (${refLink('goldfarb2021')}). Consider whether the decision in step 5 should be a new design, or limit this map to the dimensions that can be varied on existing data.</div>` : ''; })()}
    <p class="small"><strong>${n.toLocaleString()}</strong> specification${n === 1 ? '' : 's'} = ${dims.length ? dims.map((d) => `${sp.dims[d.id].options.length} ${esc(d.name.toLowerCase())}`).join(' × ') : 'nothing varies yet'}${n > SPEC_CAP ? ` <span style="color:var(--warn)">(more than ${SPEC_CAP.toLocaleString()}: drop a dimension or some options before allocating)</span>` : ''}. Dimensions that are not ticked are held at the original study's choice. Control sets are options, not all subsets of controls: following ${refLink('king2021', 'King et al.\'s (2021)')} etiquette, each set should be theoretically motivated. A map is a prioritising tool: start with the two or three dimensions that matter most (step 9 ranks them) and widen later.${n > 1000 ? ` <span style="color:var(--warn)">More than 1,000 specifications is a brute-force universe; most of these cells carry no information a reader can weigh.</span>` : ''}</p>
    <label>What every run must report, so that results are comparable (the map's T) <span class="muted">— this is what each analyst types into the result form</span><select id="mvStatSel">${['Coefficient on X (or marginal effect), its standard error, and N', 'Standardised coefficient on X, its standard error, and N', 'Odds ratio or incidence-rate ratio for X, its confidence interval, and N', 'Other (describe below)'].map((o) => `<option ${(sp.stat || '').startsWith(o.split(' (')[0]) || (o.startsWith('Other') && sp.stat && !['Coefficient', 'Standardised', 'Odds'].some((k) => (sp.stat || '').startsWith(k))) ? 'selected' : ''}>${o}</option>`).join('')}</select></label><input id="mvStat" value="${esc(sp.stat || '')}" placeholder="e.g. average marginal effect of X on Y at the mean, with 95% interval">
    <p class="actions" style="margin-top:.5rem"><button class="small" id="suggestAlt" title="The tool reads the options above and your step-5 judgments, then proposes options no study has used, preferring ones that relax a questionable or violated assumption; you add the ones you find credible">Ask the tool to propose alternatives (it reads your map and judgments)</button></p>${(sp.suggested || []).length ? `<div class="note" style="margin-top:.4rem"><strong>Proposed alternatives</strong> (click to add; the tool proposes, you decide):<ul class="small">${sp.suggested.map((s, i) => `<li><button class="small ghost" data-take-alt="${i}">+ ${esc(ddName(s.dim))}: ${esc(s.option)}</button> <span class="muted">${esc(s.reason)}${s.relaxes ? ` · relaxes: ${esc(s.relaxes)}` : ''}</span></li>`).join('')}</ul></div>` : ''}</div>
  <div class="card"><h3>2 · Legend <span class="small muted">— where prior studies sit, and what you judged</span></h3>
    ${specs ? `<p class="small">${specs.filter((s) => s.prior.length).length} of ${specs.length} specifications have been run by a prior study; <strong>${specs.filter((s) => !s.prior.length).length}</strong> have not.</p>` : ''}
    <table><tr><th>Prior study</th><th>Its assumption set</th><th>Result</th></tr>${testsOf(pid).map((t) => `<tr><td>${esc(short(study(t.study)))}${t.study_label ? ' ' + esc(t.study_label) : ''}</td><td class="small">${dims.map((d) => { let v = t.design?.[d.id]; if (Array.isArray(v)) v = v.join(', '); return `${esc(d.name)}: ${esc(v || '—')}`; }).join(' · ') || '<span class="muted">no dimension varies</span>'}</td><td class="small">${esc(t.result?.direction || '?')} / ${esc(t.result?.support || '?')}${t.result?.statistic ? ` · ${esc(t.result.statistic)}` : ''}</td></tr>`).join('')}</table>
    ${judged.length ? `<p class="small" style="margin-top:.5rem"><strong>Credibility weights (your step-5 judgments):</strong></p><ul class="small">${judged.map((a) => `<li><span class="status ${{ reasonable: 'confirmed', questionable: 'ai', violated: 'rejected' }[a.judgment]}">${esc(a.judgment)}</span> ${esc(a.text)}${(a.source || []).length ? ` <span class="muted">(${(a.source || []).map(ddName).join(', ')})</span>` : ''}</li>`).join('')}</ul>` : '<p class="small muted">No judgments recorded in step 5 yet; the legend will list them here as credibility weights.</p>'}
    ${(F.decisions || {})[pid]?.choice ? `<p class="small"><strong>Your decision (step 5):</strong> ${esc(F.decisions[pid].choice)}${F.decisions[pid].reason ? ` — ${esc(F.decisions[pid].reason)}` : ''}</p>` : ''}</div>
  <div class="card"><h3>3 · Specifications <span class="small muted">— the multiverse plan</span></h3><p class="small">${specs ? `${specs.length.toLocaleString()} specifications for this prediction, ${specs.filter((s) => s.prior.length).length} already run by a prior study.` : `More than ${SPEC_CAP.toLocaleString()} specifications; untick a dimension or remove options before downloading.`}</p><p class="actions"><a href="/api/fields/${F.id}/specs.csv?prediction=${encodeURIComponent(pid)}"><button class="ghost" ${specs ? '' : 'disabled'}>Download the specification list (CSV)</button></a> <a class="small" href="#field/${F.id}/teams">or allocate it to teams in step 8 →</a></p><p class="small muted">One row per specification, the nine dimensions as columns (dimensions that do not vary say “fixed”), plus which prior studies ran it. Run them in R or Python and add the results in step 8, or let teams do it.</p></div>`;
}
function teamsBody(pid) {
  const sp = spaceFor(pid); const { dims, n, specs } = specsFor(pid); const AL = F.allocation || {}; const teams = F.teams || [];
  const runs = (F.runs || []).filter((r) => r.prediction === pid);
  const assigned = AL.prediction === pid ? AL.assignments || {} : {};
  const solo = F.many_analysts !== 'teams';
  return (solo ? '' : `  <div class="card"><h3>1 · Teams</h3>
    <div class="row"><input id="teamName" placeholder="Team name, e.g. Team A" style="flex:1"><input id="teamMembers" placeholder="Members (optional, pseudonyms are fine)" style="flex:2"><button class="small" id="addTeam">Add team</button></div>
    ${teams.length ? `<table style="margin-top:.5rem"><tr><th>Team</th><th>Members</th><th>Assigned</th><th>Submitted</th><th>Link</th><th></th></tr>${teams.map((t) => `<tr><td><b>${esc(t.name)}</b>${t.fork && AL.mode === 'fork' ? `<br><span class="small muted">varies ${esc(ddName(t.fork))}</span>` : ''}</td><td class="small">${esc(t.members || '')}</td><td>${(assigned[t.id] || []).length}${AL.mode === 'free' ? ' (free choice)' : ''}</td><td>${runs.filter((r) => r.team === t.id).length}</td><td><button class="small ghost" data-copy="${esc(teamLink(t))}">Copy link</button> <a class="small" href="${esc(teamLink(t))}" target="_blank" rel="noopener">open</a></td><td><button class="small ghost danger" data-del-team="${t.id}">Remove</button></td></tr>`).join('')}</table>` : '<p class="small muted">No teams yet. Add the teams (or individual analysts) who will run specifications; each gets a link that shows only their assignment and a form to submit results.</p>'}
    <div class="row" style="margin-top:.6rem;align-items:flex-end"><label style="flex:2">Allocation<select id="allocMode"><option value="all" ${AL.mode === 'all' ? 'selected' : ''}>Every team runs every specification (many-analysts: compare analysts)</option><option value="split" ${AL.mode === 'split' ? 'selected' : ''}>Split the specifications randomly across teams (cover the map faster)</option><option value="fork" ${AL.mode === 'fork' ? 'selected' : ''}>One forking dimension per team (each team varies one decision, others held at baseline)</option><option value="free" ${AL.mode === 'free' ? 'selected' : ''}>Free choice: teams pick their own assumption set and report it</option></select></label><label style="flex:1">Random seed<input id="allocSeed" type="number" value="${AL.seed || 1}"></label><button id="allocate" ${teams.length && specs ? '' : 'disabled'}>Allocate</button></div>
    ${AL.prediction === pid && AL.mode ? `<p class="small muted">Allocated ${new Date(AL.at).toLocaleString()} · mode: ${esc(AL.mode)} · seed ${AL.seed}. Re-allocating replaces the assignment; submitted results are kept.</p>` : ''}</div>`) + `
  <div class="card"><h3>${solo ? 'The map so far' : '2 · The map so far'} <span class="small muted">— ${runs.length} result${runs.length === 1 ? '' : 's'} submitted</span></h3>
    ${specCurveSvg(runs)}
    ${runs.length ? `<table style="margin-top:.5rem"><tr><th>Specification</th><th>Team</th><th>Estimate</th><th>SE</th><th>N</th><th>Direction / support</th><th>Notes</th><th></th></tr>${runs.slice().sort((a, b) => Number(a.estimate) - Number(b.estimate)).map((r) => `<tr><td class="small" title="${esc(dims.map((d) => `${d.name}: ${r.spec?.[d.id] ?? '—'}`).join('\n'))}">${dims.map((d) => `<span class="opt">${esc(r.spec?.[d.id] ?? '—')}</span>`).join('') || esc(r.spec_id)}</td><td>${esc((teams.find((t) => t.id === r.team) || {}).name || r.team)}${r.by ? `<br><span class="small muted">${esc(r.by)}</span>` : ''}</td><td>${esc(r.estimate)}</td><td>${esc(r.se || '')}</td><td>${esc(r.n || '')}</td><td class="small">${esc(r.direction || '')} / ${esc(r.support || '')}</td><td class="small">${esc(r.notes || '')}</td><td><button class="small ghost danger" data-del-run="${r.id}">×</button></td></tr>`).join('')}</table>` : ''}
    <details style="margin-top:.6rem" ${solo ? 'open' : ''}><summary class="small">Upload results from R, Python or Stata (CSV)</summary><p class="small muted" style="margin:.3rem 0">Download the specification list, keep its <code>spec_id</code> column, add the columns <code>estimate</code>, <code>se</code>, <code>n</code> (and optionally <code>direction</code>, <code>support</code>, <code>notes</code>, <code>analyst</code>), one row per specification you ran, and upload it here. Rows whose <code>spec_id</code> is not in the current list are skipped and reported.</p><input type="file" id="runsCsv" accept=".csv,text/csv"></details>
    <details style="margin-top:.6rem" ${solo ? 'open' : ''}><summary class="small">${solo ? 'Record a single result by hand' : 'Add a result yourself (if you ran specifications without teams)'}</summary>${specs ? `<form id="ownRun" class="runform" style="margin-top:.4rem"><label>Specification<select name="spec">${specs.map((s) => `<option value="${s.id}">${esc(dims.map((d) => s.spec[d.id]).join(' · '))}</option>`).join('')}</select></label><div class="row"><input name="estimate" placeholder="Estimate" required style="flex:1"><input name="se" placeholder="Standard error" style="flex:1"><input name="n" placeholder="N" style="flex:1"></div><div class="row"><select name="direction"><option value="">direction…</option><option>positive</option><option>negative</option><option>null</option></select><select name="support"><option value="">support…</option><option>supported</option><option>not supported</option><option>partly</option></select></div><input name="notes" placeholder="Notes"><button class="small">Add result</button></form>` : '<p class="small muted">Reduce the assumption space first.</p>'}</details>
    <p class="actions" style="margin-top:.6rem"><a href="/api/fields/${F.id}/specs.csv?prediction=${encodeURIComponent(pid)}"><button class="ghost">Specifications (CSV)</button></a><a href="/api/fields/${F.id}/runs.csv?prediction=${encodeURIComponent(pid)}"><button class="ghost">Results (CSV)</button></a></p><p class="small muted">The specification list is the input to a multiverse in R or Python; the results file is the map as a database, one row per assumption set and estimate (${refLink('king2021', 'King et al., 2021')}, recommend publishing exactly this). Both files are named after the prediction.</p></div>`;
}

/* 8 TEAMS & RESULTS */
function renderTeams(p) {
  const core = F.predictions.filter((x) => x.status === 'confirmed' && x.core);
  const AL = F.allocation || {}; const curPid = AL.prediction && core.some((c) => c.id === AL.prediction) ? AL.prediction : core[0]?.id;
  const teams = F.teams || (F.teams = []);
  p.innerHTML = `<h2>8. Many analysts (optional): run the map with teams, collect the results</h2>
  <div class="intro"><strong>Why teams?</strong> A multiverse can be run by one person, but the same assumption space can also be given to several independent analysts or teams. That is the <em>many-analysts</em> design: when different teams reach different estimates from the same data and the same assumption set, the difference is analyst-induced uncertainty; when they agree, the map's cells are more credible. In management research this has been done once, by ${refLink('delios2025')}, who gave one dataset to 57 analysts; in psychology and economics it is now common (${refLink('silberzahn2018')}; ${refLink('breznau2022')}; ${refLink('hk2021')}). This step makes it routine: add teams, choose how to allocate the specifications from step 7 (everyone runs everything, a random split, one forking dimension per team, or free choice), send each team its link, and their results return here as a specification curve: the completed epistemic map. If you work alone, skip the teams and add your own results below.</div>
  ${routeBanner('teams')}
  <div class="card"><strong>Will this map be run by several analysts or teams?</strong><div class="row" style="margin:.4rem 0"><label class="radio"><input type="radio" name="manyMode" value="teams" ${F.many_analysts === 'teams' ? 'checked' : ''}> Yes: a many-analysts study (teams, allocation, links)</label><label class="radio"><input type="radio" name="manyMode" value="solo" ${F.many_analysts === 'solo' || !F.many_analysts ? 'checked' : ''}> No: I run the multiverse myself and record the results here</label></div></div>
  ${core.length ? `<div class="card"><label>Prediction<select id="mvPred">${core.map((c) => `<option value="${c.id}" ${c.id === curPid ? 'selected' : ''}>${esc(c.text)}</option>`).join('')}</select></label></div>` + teamsBody(curPid) : `<div class="empty-state"><h3>No core predictions yet</h3><p>Confirm predictions in step 3 and mark the core ones; build the assumption space in step 7.</p></div>`}
  ${loopBar()}`;
  p.addEventListener('change', (e) => { if (e.target.name === 'manyMode') { F.many_analysts = e.target.value; markDirty(); renderStep(); } });
  $('#mvPred')?.addEventListener('change', (e) => { F.allocation = { ...(F.allocation || {}), prediction: e.target.value }; markDirty(); renderStep(); });
  p.addEventListener('click', async (e) => {
    const t = e.target; const pid = $('#mvPred')?.value; if (!pid) return;
    if (t.id === 'addTeam') { const name = ($('#teamName').value || '').trim(); if (!name) return; teams.push({ id: uid('tm_'), name, members: ($('#teamMembers').value || '').trim(), created: new Date().toISOString() }); markDirty(); renderStep(); }
    if (t.dataset.delTeam) { const id = t.dataset.delTeam; if (!confirm('Remove this team? Its submitted results are kept.')) return; F.teams = teams.filter((x) => x.id !== id); if (F.allocation?.assignments) delete F.allocation.assignments[id]; markDirty(); renderStep(); }
    if (t.dataset.copy) { try { await navigator.clipboard.writeText(t.dataset.copy); toast('Link copied'); } catch { prompt('Copy this link', t.dataset.copy); } }
    if (t.id === 'allocate') { try { allocate(pid, $('#allocMode').value, $('#allocSeed').value); toast('Specifications allocated'); renderStep(); } catch (err) { toast(err.message, true); } }
    if (t.dataset.delRun) { if (!confirm('Delete this submitted result?')) return; F.runs = (F.runs || []).filter((r) => r.id !== t.dataset.delRun); markDirty(); renderStep(); }
  });
  p.addEventListener('change', async (e) => {
    if (e.target.id !== 'runsCsv') return; const file = e.target.files[0]; if (!file) return; const pid = $('#mvPred').value; const { specs } = specsFor(pid); if (!specs) return toast('Reduce the assumption space first', true);
    const text = await file.text(); const rows = parseCsv(text); if (!rows.length) return toast('Empty or unreadable CSV', true);
    const byId = new Map(specs.map((s) => [s.id, s])); let added = 0; const skipped = [];
    for (const r of rows) { const id = r.spec_id || r.specification_id; const s = byId.get(id); if (!s) { skipped.push(id || '(no spec_id)'); continue; } if (r.estimate === undefined || r.estimate === '') { skipped.push(id + ' (no estimate)'); continue; } (F.runs ||= []).push({ id: uid('run_'), prediction: pid, spec_id: s.id, spec: s.spec, team: 'owner', by: r.analyst || 'csv upload', estimate: r.estimate, se: r.se || r.standard_error || '', n: r.n || r.N || '', direction: r.direction || '', support: r.support || '', notes: r.notes || '', at: new Date().toISOString() }); added++; }
    markDirty(); toast(`${added} result${added === 1 ? '' : 's'} added${skipped.length ? `; ${skipped.length} row${skipped.length === 1 ? '' : 's'} skipped (${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''})` : ''}`, !added); renderStep();
  });
  p.addEventListener('submit', (e) => {
    if (e.target.id !== 'ownRun') return; e.preventDefault(); const pid = $('#mvPred').value; const fd = new FormData(e.target); const { specs } = specsFor(pid); const s = specs.find((x) => x.id === fd.get('spec')); if (!s) return;
    (F.runs ||= []).push({ id: uid('run_'), prediction: pid, spec_id: s.id, spec: s.spec, team: 'owner', by: 'field owner', estimate: fd.get('estimate'), se: fd.get('se'), n: fd.get('n'), direction: fd.get('direction'), support: fd.get('support'), notes: fd.get('notes'), at: new Date().toISOString() });
    markDirty(); toast('Result added to the map'); renderStep();
  });
}

/* INDEPENDENT JUDGMENTS: colleagues judge the same assumptions through a link, without seeing the owner's judgments */
const JUD = ['reasonable', 'questionable', 'violated'];
function judgeLink(j) { return `${location.origin}${location.pathname}#field/${F.id}/judge/${j.id}`; }
function indepBlock(pid) {
  const ab = (F.assumptions_by_prediction || {})[pid]; const js = (F.judges || []).filter((j) => j.prediction === pid); const done = js.filter((j) => j.judgments);
  const own = (ab.assumptions || []).map((x) => x.judgment || '');
  const rows = (ab.assumptions || []).map((x, i) => { const votes = done.map((j) => j.judgments[x.key || String(i)] || ''); const all = [own[i], ...votes].filter(Boolean); const agree = all.length > 1 ? Math.round(100 * (Math.max(...JUD.map((v) => all.filter((z) => z === v).length)) / all.length)) : null; return { x, votes, agree }; });
  const overall = rows.filter((r) => r.agree !== null); const mean = overall.length ? Math.round(overall.reduce((s, r) => s + r.agree, 0) / overall.length) : null;
  return `<details style="margin-top:.5rem" ${js.length ? 'open' : ''}><summary class="small"><strong>Independent judgments from colleagues</strong> ${done.length ? `· ${done.length} of ${js.length} submitted${mean !== null ? ` · mean agreement ${mean}%` : ''}` : js.length ? `· ${js.length} link${js.length === 1 ? '' : 's'} created, none submitted yet` : '· none yet'}</summary>
    <p class="small muted" style="margin:.3rem 0">Each colleague gets a link that shows these assumptions and the tests, but <em>not</em> your judgments or anyone else's. They judge independently; their verdicts appear here beside yours with the agreement per assumption. Paste the link into an email; the tool does not send mail. In a many-analysts study the same links give each team's judgment before they run anything.</p>
    <div class="row"><input data-judge-name="${pid}" placeholder="Colleague's name or pseudonym" style="flex:1"><button class="small ghost" data-add-judge="${pid}">Create a link</button></div>
    ${js.length ? `<table style="margin-top:.4rem"><tr><th>Colleague</th><th>Status</th><th>Link</th><th></th></tr>${js.map((j) => `<tr><td>${esc(j.name)}</td><td>${j.judgments ? `<span class="status confirmed">submitted</span> <span class="small muted">${new Date(j.at).toLocaleDateString()}</span>` : '<span class="status candidate">waiting</span>'}</td><td><button class="small ghost" data-copy="${esc(judgeLink(j))}">Copy link</button></td><td><button class="small ghost danger" data-del-judge="${j.id}">Remove</button></td></tr>`).join('')}</table>` : ''}
    ${done.length ? `<table style="margin-top:.5rem"><tr><th>Assumption</th><th>You</th>${done.map((j) => `<th>${esc(j.name)}</th>`).join('')}<th>Agreement</th></tr>${rows.map((r) => `<tr><td class="small">${esc(r.x.text)}</td><td><span class="status ${{ reasonable: 'confirmed', questionable: 'ai', violated: 'rejected' }[own[rows.indexOf(r)]] || ''}">${esc(own[rows.indexOf(r)] || '—')}</span></td>${r.votes.map((v) => `<td><span class="status ${{ reasonable: 'confirmed', questionable: 'ai', violated: 'rejected' }[v] || ''}">${esc(v || '—')}</span></td>`).join('')}<td>${r.agree === null ? '—' : `${r.agree}%${r.agree < 100 ? ' <span class="small" style="color:var(--warn)">disagree</span>' : ''}`}</td></tr>`).join('')}</table><p class="small muted">Agreement = share of judges (you included) choosing the modal verdict. Disagreement is a finding about the field, not an error; the notes colleagues left are in the export.</p>` : ''}
  </details>`;
}
function renderJudge(p) {
  const j = (F.judges || []).find((x) => x.id === TEAM_ID); document.body.classList.add('team-view');
  if (!j) { p.innerHTML = `<div class="empty-state"><h3>Unknown link</h3><p>Ask the field's owner for a current link.</p></div>`; return; }
  const pr = pred(j.prediction); const ab = (F.assumptions_by_prediction || {})[j.prediction]; const ts = testsOf(j.prediction);
  if (!pr || !ab) { p.innerHTML = `<div class="empty-state"><h3>Nothing to judge yet</h3></div>`; return; }
  const cur = j.judgments || {};
  p.innerHTML = `<h2>Independent judgment <span class="small muted">· for ${esc(j.name)}</span></h2>
  <div class="intro"><strong>Prediction:</strong> ${esc(pr.text)}${pr.statement ? ` — ${esc(pr.statement)}` : ''}<br>Below are the assumptions that the existing tests of this prediction rest on, as unearthed from the papers, and the tests themselves. Please judge each assumption from your own knowledge of the field as <strong>reasonable</strong>, <strong>questionable</strong> or <strong>violated</strong>. You do not see the field owner's judgments or anyone else's; yours are compared with theirs afterwards.${j.judgments ? ' <strong>You have already submitted; you can revise and submit again.</strong>' : ''}</div>
  <div class="card"><h3>The tests (${ts.length})</h3><table><tr><th>Study</th><th>Design</th><th>Result</th></tr>${ts.map((t) => `<tr><td>${esc(short(study(t.study)))}</td><td class="small">${DD().map((d) => { let v = t.design?.[d.id]; if (Array.isArray(v)) v = v.join(', '); return v ? `<b>${esc(d.name)}</b>: ${esc(v)}` : ''; }).filter(Boolean).join(' · ')}</td><td class="small">${esc(t.result?.direction || '?')} / ${esc(t.result?.support || '?')}</td></tr>`).join('')}</table></div>
  <div class="card"><h3>The assumptions (${ab.assumptions.length})</h3><form id="judgeForm"><table><tr><th>Assumption</th><th>From</th><th>Would be relaxed by</th><th>Your judgment</th></tr>${ab.assumptions.map((x, i) => `<tr><td>${esc(x.text)}</td><td class="small">${esc((x.source || []).map(ddName).join(', '))}</td><td class="small">${esc(x.relaxed_by || '')}</td><td><select name="j:${x.key || i}"><option value="">—</option>${JUD.map((v) => `<option ${cur[x.key || String(i)] === v ? 'selected' : ''}>${v}</option>`).join('')}</select><input name="n:${x.key || i}" placeholder="why (optional)" value="${esc((j.notes || {})[x.key || String(i)] || '')}" style="margin-top:.3rem"></td></tr>`).join('')}</table><p class="actions" style="margin-top:.6rem"><button>Submit my judgments</button></p></form></div>`;
  $('#judgeForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(e.target); const judgments = {}, notes = {}; for (const [k, v] of fd.entries()) { if (k.startsWith('j:') && v) judgments[k.slice(2)] = v; if (k.startsWith('n:') && v) notes[k.slice(2)] = v; }
    if (!Object.keys(judgments).length) return toast('Judge at least one assumption', true);
    const btn = e.target.querySelector('button'); busy(btn, true, 'Saving…');
    try { await submitJudge(j.id, judgments, notes); api('/api/event', { fieldId: F.id, type: 'judgment', payload: { by: 'colleague', judge: j.id, prediction: j.prediction, n: Object.keys(judgments).length } }).catch(() => {}); toast('Thank you: your judgments were recorded'); renderStep(); }
    catch (err) { toast(err.message, true); busy(btn, false); }
  });
}
async function submitJudge(jid, judgments, notes) {
  for (let i = 0; i < 4; i++) {
    const fresh = await api(`/api/fields/${F.id}`); const j = (fresh.judges || []).find((x) => x.id === jid); if (!j) throw new Error('This link was removed by the field owner'); j.judgments = judgments; j.notes = notes; j.at = new Date().toISOString();
    try { const { version } = await api(`/api/fields/${F.id}`, { doc: fresh, version: fresh.version || 1 }, 'PUT'); F = { ...fresh, version }; VERSION = version; lastSaved = JSON.stringify(F); return; }
    catch (e) { if (!/changed by someone else|409/i.test(e.message) || i === 3) throw e; }
  }
}

/* TEAM VIEW: what an analyst team sees through its link */
function renderTeam(p) {
  const tid = TEAM_ID; const team = (F.teams || []).find((t) => t.id === tid);
  document.body.classList.add('team-view');
  if (!team) { p.innerHTML = `<div class="empty-state"><h3>Unknown team link</h3><p>Ask the field's owner for a current link (step 7).</p></div>`; return; }
  const AL = F.allocation || {}; const pid = AL.prediction; const pr = pid ? pred(pid) : null;
  if (!pr) { p.innerHTML = `<h2>${esc(team.name)}</h2><div class="empty-state"><h3>Nothing allocated yet</h3><p>The field's owner has not allocated specifications to teams.</p></div>`; return; }
  const { dims, specs } = specsFor(pid); const sp = spaceFor(pid); const ids = AL.assignments?.[tid] || []; const mine = (specs || []).filter((s) => ids.includes(s.id));
  const runs = (F.runs || []).filter((r) => r.team === tid); const done = new Set(runs.map((r) => r.spec_id));
  const who = sessionStorage.getItem('cm.analyst') || '';
  const row = (s) => `<tr class="${done.has(s.id) ? 'done' : ''}"><td class="small">${dims.map((d) => `<b>${esc(d.name)}</b>: ${esc(s.spec[d.id])}`).join('<br>')}${s.prior.length ? `<br><span class="status candidate">run before by ${s.prior.map((t) => esc(short(study(t.study)))).join(', ')}</span>` : ''}</td><td>${done.has(s.id) ? `<span class="status confirmed">submitted</span> ${runs.filter((r) => r.spec_id === s.id).map((r) => esc(r.estimate)).join(', ')}` : `<form data-spec="${s.id}" class="runform"><div class="row"><input name="estimate" placeholder="Estimate" required style="flex:1"><input name="se" placeholder="SE" style="flex:1"><input name="n" placeholder="N" style="flex:1"></div><div class="row"><select name="direction"><option value="">direction…</option><option>positive</option><option>negative</option><option>null</option></select><select name="support"><option value="">support…</option><option>supported</option><option>not supported</option><option>partly</option></select></div><input name="notes" placeholder="Notes: software, deviations, anything the map should know"><button class="small">Submit</button></form>`}</td></tr>`;
  p.innerHTML = `<h2>${esc(team.name)} <span class="small muted">· analyst view</span></h2>
  <div class="intro"><strong>Prediction:</strong> ${esc(pr.text)}${pr.statement ? ` — ${esc(pr.statement)}` : ''}<br><strong>Report for each specification:</strong> ${esc(sp.stat || 'the coefficient on X, its SE and N')}. Dimensions not listed are held at the original study's choice. Your submissions are added to the field's map; the field owner sees them as a specification curve.</div>
  <div class="card"><label>Your name or pseudonym (saved for this browser tab)<input id="analyst" value="${esc(who)}" placeholder="e.g. Team A / Maria"></label></div>
  ${AL.mode === 'free' ? `<div class="card"><h3>Choose your own assumption set</h3><p class="small muted">Free-choice mode: pick one option per dimension, run it, and report.</p><form id="freeRun" class="runform">${dims.map((d) => `<label>${esc(d.name)}<select name="d:${d.id}">${sp.dims[d.id].options.map((o) => `<option>${esc(o)}</option>`).join('')}</select></label>`).join('')}<div class="row"><input name="estimate" placeholder="Estimate" required style="flex:1"><input name="se" placeholder="SE" style="flex:1"><input name="n" placeholder="N" style="flex:1"></div><div class="row"><select name="direction"><option value="">direction…</option><option>positive</option><option>negative</option><option>null</option></select><select name="support"><option value="">support…</option><option>supported</option><option>not supported</option><option>partly</option></select></div><input name="notes" placeholder="Notes"><button class="small">Submit</button></form></div>` : `<div class="card"><h3>Your ${mine.length} specification${mine.length === 1 ? '' : 's'} <span class="small muted">· ${mine.filter((s) => done.has(s.id)).length} submitted</span></h3>${mine.length ? `<table><tr><th>Assumption set</th><th>Your result</th></tr>${mine.map(row).join('')}</table>` : '<p class="muted">Nothing assigned to this team yet.</p>'}</div>`}
  ${runs.length ? `<div class="card"><h3>Submitted by this team</h3>${specCurveSvg(runs)}</div>` : ''}`;
  $('#analyst').addEventListener('input', (e) => sessionStorage.setItem('cm.analyst', e.target.value));
  p.addEventListener('submit', async (e) => {
    e.preventDefault(); const form = e.target; const fd = new FormData(form); let spec, spec_id;
    if (form.id === 'freeRun') { spec = Object.fromEntries(dims.map((d) => [d.id, fd.get('d:' + d.id)])); spec_id = `${pid}:free:${dims.map((d) => sp.dims[d.id].options.indexOf(spec[d.id])).join('.')}`; }
    else { const s = (specs || []).find((x) => x.id === form.dataset.spec); spec = s.spec; spec_id = s.id; }
    const run = { id: uid('run_'), prediction: pid, spec_id, spec, team: tid, by: $('#analyst').value.trim(), estimate: fd.get('estimate'), se: fd.get('se'), n: fd.get('n'), direction: fd.get('direction'), support: fd.get('support'), notes: fd.get('notes'), at: new Date().toISOString() };
    const btn = form.querySelector('button'); busy(btn, true, 'Saving…');
    try { await submitRun(run); api('/api/event', { fieldId: F.id, type: 'run', payload: { team: tid, spec_id } }).catch(() => {}); toast('Result added to the map'); renderStep(); }
    catch (err) { toast(err.message, true); busy(btn, false); }
  });
}
// Several teams write to the same field, so a submission reloads the field and retries on a version conflict.
async function submitRun(run) {
  for (let i = 0; i < 4; i++) {
    const fresh = await api(`/api/fields/${F.id}`); fresh.runs = fresh.runs || []; fresh.runs.push(run);
    try { const { version } = await api(`/api/fields/${F.id}`, { doc: fresh, version: fresh.version || 1 }, 'PUT'); F = { ...fresh, version }; VERSION = version; lastSaved = JSON.stringify(F); return; }
    catch (e) { if (!/changed by someone else|409/i.test(e.message) || i === 3) throw e; }
  }
}

/* 8 EXPORT */
function renderExport(p) {
  const conf = (arr) => arr.filter((x) => x.status === 'confirmed').length;
  const core = F.predictions.filter((x) => x.status === 'confirmed' && x.core);
  const decisions = []; for (const pr of core) for (const d of DD()) { const r = designRange(pr.id, d.id); if (r.length > 1) { const results = new Set(r.flatMap((o) => o.tests.map((t) => t.result?.support)).filter(Boolean)); decisions.push({ pr, d, options: r.length, mixed: results.size > 1 }); } }
  decisions.sort((a, b) => (b.mixed - a.mixed) || (b.options - a.options));
  const DEC = F.decisions || {};
  p.innerHTML = `<h2>9. Reproduce, replicate, export</h2>
  ${routeBanner('export')}
  <div class="intro">What leaves this map. The specification list (step 7) and the collected results (step 8) are the epistemic map as a database. For each core prediction you decided on in step 5, the hand-off opens <strong>Evidence Navigator</strong> with the prediction, the evidence, the design range and your decision pre-filled; its reproduction stage can generate analysis code from the original paper, and its later stages plan a preregistered replication. The exports feed a multiverse.</div>
  <div class="card"><h3>Decisions</h3>${Object.keys(DEC).length ? `<table><tr><th>Prediction</th><th>Decision</th><th>Reason</th><th></th></tr>${Object.entries(DEC).map(([pid, d]) => { const pr = pred(pid); return pr ? `<tr><td>${esc(pr.text)}</td><td>${esc(d.choice || '')}</td><td class="small">${esc(d.reason || '')}</td><td>${planLink(pr, d)}</td></tr>` : ''; }).join('')}</table>` : '<p class="muted">No decisions yet (step 5).</p>'}</div>
  <div class="card"><h3>Status of “${esc(F.name)}”</h3><table><tr><th></th><th>Total</th><th>Confirmed</th></tr><tr><td>Studies in corpus / core / read</td><td>${F.studies.length}</td><td>${F.studies.filter((s) => s.core).length} / ${F.studies.filter((s) => s.extraction).length}</td></tr><tr><td>Predictions (core)</td><td>${F.predictions.length}</td><td>${conf(F.predictions)} (${core.length})</td></tr><tr><td>Tests (prediction × study)</td><td>${F.tests.length}</td><td>${conf(F.tests)}</td></tr><tr><td>Analytical choices</td><td>${F.choices.length}</td><td>${conf(F.choices)}</td></tr></table></div>
  <div class="card"><h3>Core predictions</h3>${core.length ? `<ol>${core.map((pr) => { const ts = testsOf(pr.id); return `<li><strong>${esc(pr.text)}</strong> <span class="small muted">— ${ts.length} test${ts.length === 1 ? '' : 's'}, ${ts.filter((t) => t.result?.support === 'supported').length} supported; first in ${esc(short(study(pr.study)))}</span> ${planLink(pr)}</li>`; }).join('')}</ol>` : '<p class="muted">None marked yet (step 3).</p>'}</div>
  <div class="card"><h3>Design decisions that matter most</h3><p class="small muted">Dimensions where studies made different choices, ranked with mixed results first. These are the inputs to a multiverse and the first candidates for the next test.</p>${decisions.length ? `<ol>${decisions.slice(0, 12).map((x) => `<li><strong>${esc(x.d.name)}</strong> for “${esc(x.pr.text)}”: ${x.options} options${x.mixed ? ', <span style="color:var(--warn)">mixed results</span>' : ', consistent results'}</li>`).join('')}</ol><p class="small"><a href="#field/${F.id}/multiverse">Vary them in the multiverse (step 7) →</a></p>` : '<p class="muted">Nothing varies yet: import more studies that test the same prediction.</p>'}${CFG.navigatorUrl ? '' : '<p class="small muted">Set NAVIGATOR_URL on the server to add “Plan this test” links that open Evidence Navigator with the prediction and design options pre-filled.</p>'}</div>
  <div class="card"><h3>Downloads</h3><p class="actions"><a href="/api/fields/${F.id}/export.json"><button>Field as JSON</button></a><a href="/api/fields/${F.id}/designs.csv"><button class="ghost">Design table (CSV)</button></a><a href="/api/fields/${F.id}/judgments.csv"><button class="ghost">Judgments, yours and colleagues' (CSV)</button></a></p><p class="small muted">The JSON holds everything and can be re-imported. The CSV is one row per prediction × study with the nine design dimensions and the result, for R or Python.</p></div>
  <div class="card"><h3>Notes</h3><textarea id="notes" style="min-height:120px" placeholder="Coding decisions, who confirmed what, open questions…">${esc(F.notes || '')}</textarea></div>`;
  $('#notes').addEventListener('input', (e) => { F.notes = e.target.value; markDirty(); });
}

// ---------- boot ----------
(async () => { CFG = await api('/api/config'); if (CFG.navigatorUrl) { for (const id of ['#topNav', '#footNav']) { const el = $(id); if (el) { el.href = CFG.navigatorUrl; el.hidden = false; } } } const d = $('#dbState'); d.hidden = false; d.textContent = CFG.store === 'postgres' ? 'Database connected' : 'File storage'; d.classList.toggle('files', CFG.store !== 'postgres'); route(); })();

// ================= AI coach =================
const STARTERS = {
  inquiry: ['How do I turn my interest into search terms?', 'Which seed studies should I start from?', 'Is this question worth a replication at all?'],
  assumptions: ['Which of these assumptions is most consequential?', 'Multiverse or new study: how do I decide here?', 'What design would relax the violated assumption?'],
  corpus: ['How do I bound this field?', 'Which studies should be core: seminal, recent or rising?', 'Should reviews be in the corpus?'],
  studies: ['What should I check in an extraction before importing it?', 'The paper has no hypotheses; what is its prediction?'],
  predictions: ['Are these two predictions the same?', 'Which predictions here are core?', 'Is this a prediction or a finding?'],
  designs: ['Which design decision matters most for this prediction?', 'Do the mixed results come from the design or the sample?', 'What is missing from the design range?'],
  choices: ['Which choices form a reasonable multiverse?', 'How do I judge a missed vs an added choice?'],
  multiverse: ['What is an epistemic map, and what goes in its legend?', 'Which dimensions should vary in this map?', 'How many specifications are reasonable?'],
  teams: ['What is a many-analysts study, and when is it worth it?', 'How should I split the specifications across teams?', 'How do I report the map once results are in?'],
  export: ['What is the most informative next test?', 'Draft a one-paragraph justification for the next test', 'How should I report the design map?']
};
const CHAT = {}; // step -> messages[]
let CARDS = null, streaming = false;
function cites(text) { return esc(text || '').replace(/\[([a-z]+\d{4}-\d{2,3})\]/g, (m, id) => `<a class="cite" data-card="${id}" title="Evidence card ${id}">${citeLabel(id)}</a>`); }
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  return rows.filter((r) => r.some((x) => x !== '')).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
function citeLabel(id) { const c = CARDS?.byId.get(id); const s = c && CARDS.src.get(c.source); const n = Number((id.split('-')[1] || '').replace(/^0+/, '')) || ''; return s ? `${s.short}${n ? `, card ${n}` : ''}` : id; }
const SESSION = (() => { try { let s = sessionStorage.getItem('cm.sid'); if (!s) { s = uid('cm_'); sessionStorage.setItem('cm.sid', s); } return s; } catch { return uid('cm_'); } })();
async function cardsIndex() { if (CARDS) return CARDS; const k = await api('/api/knowledge'); CARDS = { byId: new Map(k.cards.map((c) => [c.id, c])), src: new Map(k.sources.map((s) => [s.key, s])), topic: new Map((k.topics || []).map((t) => [t.id, t])) }; return CARDS; }
function mdLite(text) {
  const lines = esc(text).split('\n'); let out = '', inList = false;
  for (const l of lines) {
    const li = /^\s*[-•*]\s+(.*)/.exec(l);
    if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${li[1]}</li>`; continue; }
    if (inList) { out += '</ul>'; inList = false; }
    if (l.trim()) out += `<p>${l}</p>`;
  }
  if (inList) out += '</ul>';
  return out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([a-z]+\d{4}-\d{2,3})\]/g, (m, id) => `<a class="cite" data-card="${id}" title="Evidence card ${id}: click to read the source quote">${citeLabel(id)}</a>`);
}
function renderChat() {
  const box = $('#chat'); const msgs = CHAT[STEP] || [];
  box.innerHTML = msgs.length ? msgs.map((m, i) => m.role === 'user' ? `<div class="msg user">${esc(m.content)}</div>` : `<div class="msg bot ${m.error ? 'err' : ''}" data-i="${i}">${m.error ? esc(m.error) : mdLite(m.content)}${m.done ? `<div class="meta">${m.citations?.some((c) => !c.valid) ? '<span style="color:var(--bad)">Some citations do not exist in the evidence base.</span>' : ''}${m.stop === 'max_tokens' ? '<button class="small ghost" data-cont="1">Continue</button>' : ''}<button class="small ghost" data-flag="' + i + '" title="Flag a citation that does not support the claim">Flag</button></div>` : ''}</div>`).join('') : `<div class="msg bot">Hi. I can see this field's studies, predictions, the designs used to test them, and your own judgments and decisions from step 5. Ask me about this step, or pick a question above.</div>`;
  box.querySelectorAll('.cite').forEach((el) => { if (CARDS && !CARDS.byId.has(el.dataset.card)) el.classList.add('bad'); });
  box.scrollTop = box.scrollHeight;
}
function renderStarters() { $('#starters').innerHTML = (STARTERS[STEP] || []).map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join(''); $('#coachStep').textContent = `Step ${{ inquiry: 0, corpus: 1, studies: 2, predictions: 3, designs: 4, assumptions: 5, choices: 6, multiverse: 7, teams: 8, export: 9 }[STEP] ?? 1} · grounded in ${CARDS ? CARDS.byId.size : 341} evidence cards`; }
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
  modal(`<div class="card-view"><span class="dim">${esc(k.topic.get(c.topic)?.name || c.topic || c.stage)} · ${esc(c.kind)}</span><h4>${esc(c.title)} <span class="muted small">[${esc(c.id)}]</span></h4><p>${esc(c.guidance)}</p><p><strong>Action:</strong> ${esc(c.action)}</p><span class="quote">“${esc(c.quote)}” (${esc(src.short || c.source)}, p. ${c.printed_page ?? c.pdf_page})</span><p class="small muted">${esc(src.citation || '')}${src.url ? ` · <a href="${esc(src.url)}" target="_blank" rel="noopener">source</a>` : ''}</p><menu><button data-close class="ghost">Close</button></menu></div>`);
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
$('#coachOpen').addEventListener('click', () => { $('#coach').classList.add('open'); if (F) api('/api/event', { fieldId: F.id, type: 'coach_open', payload: { step: STEP } }).catch(() => {}); });
$('#coachClose').addEventListener('click', () => { $('#coach').classList.remove('open'); if (F) api('/api/event', { fieldId: F.id, type: 'coach_close', payload: { step: STEP } }).catch(() => {}); });
