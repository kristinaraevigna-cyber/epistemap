// Corpus building: OpenAlex search (open, no key) and import of Web of Science / Scopus / BibTeX
// exports in the formats bibliometrix reads. Both produce the same study record.

const OPENALEX = 'https://api.openalex.org';

export function studyRecord(p) {
  return {
    id: p.id, doi: p.doi || null, title: p.title || '', authors: p.authors || '', year: p.year || null, venue: p.venue || '',
    cited_by: p.cited_by ?? null, cites_per_year: p.cites_per_year ?? null, percentile_year: p.percentile_year ?? null, type: p.type || 'article', is_review: !!p.is_review,
    local_cites: 0, references: p.references || [], source: p.source,
    abstract: p.abstract || '', core: false, status: 'candidate', extraction: null, added: new Date().toISOString()
  };
}

const normDoi = (d) => d ? String(d).toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim() : null;

function abstractFromIndex(idx) {
  if (!idx) return '';
  const words = [];
  for (const [w, positions] of Object.entries(idx)) for (const p of positions) words[p] = w;
  return words.filter(Boolean).join(' ').slice(0, 2000);
}

// OpenAlex full-text search: quotes for phrases, OR / AND / NOT in capitals. We normalise lower-case
// operators so "greenwashing or brownwashing" works as people expect.
export function normaliseQuery(q) {
  return String(q || '').trim().replace(/\s+(or|and|not)\s+/gi, (m, op) => ` ${op.toUpperCase()} `);
}
const REVIEW_RE = /\b(review|meta-?analy|systematic|bibliometric|research agenda|state of the art|literature)\b/i;
// scope: 'title_abstract' (default; avoids full-text noise such as methods papers that merely mention a term) or 'fulltext'.
export async function searchOpenAlex({ query, fromYear, toYear, perPage = 50, page = 1, sort = 'cited_by_count:desc', scope = 'title_abstract' }) {
  const filters = ['type:article|review'];
  if (scope !== 'fulltext') filters.push(`title_and_abstract.search:${normaliseQuery(query).replace(/,/g, ' ')}`);
  if (fromYear) filters.push(`from_publication_date:${fromYear}-01-01`);
  if (toYear) filters.push(`to_publication_date:${toYear}-12-31`);
  const params = new URLSearchParams({ filter: filters.join(','), sort, per_page: String(Math.min(perPage, 200)), page: String(page), select: SELECT });
  if (scope === 'fulltext') params.set('search', normaliseQuery(query));
  if (process.env.CONTACT_EMAIL) params.set('mailto', process.env.CONTACT_EMAIL);
  const r = await fetch(`${OPENALEX}/works?${params}`, { headers: { 'user-agent': `epistemapper (${process.env.CONTACT_EMAIL || 'mailto unset'})` } });
  if (!r.ok) { let msg = ''; try { msg = (await r.json()).message || ''; } catch {} throw new Error(`OpenAlex ${r.status}${msg ? `: ${msg}` : ''}${r.status === 400 ? ' — check the query: OpenAlex accepts quoted phrases and AND / OR / NOT, but not parentheses or wildcards. Use the two term boxes to combine groups.' : ''}`); }
  const j = await r.json();
  return {
    total: j.meta?.count ?? 0,
    results: j.results.map(workToStudy)
  };
}
function workToStudy(w) {
  return studyRecord({
      id: w.id.replace('https://openalex.org/', ''), doi: normDoi(w.doi), title: w.title,
      authors: (w.authorships || []).slice(0, 6).map((a) => a.author?.display_name).filter(Boolean).join(', ') + ((w.authorships || []).length > 6 ? ' et al.' : ''),
      year: w.publication_year, venue: w.primary_location?.source?.display_name || '', cited_by: w.cited_by_count,
      cites_per_year: w.publication_year ? Math.round(10 * (w.cited_by_count || 0) / Math.max(1, new Date().getFullYear() - w.publication_year + 1)) / 10 : null,
      percentile_year: w.cited_by_percentile_year?.min ?? null, type: w.type || 'article', is_review: w.type === 'review' || REVIEW_RE.test(w.title || ''),
      references: (w.referenced_works || []).map((x) => x.replace('https://openalex.org/', '')), abstract: abstractFromIndex(w.abstract_inverted_index), source: 'openalex'
  });
}
const SELECT = 'id,doi,title,authorships,publication_year,primary_location,cited_by_count,cited_by_percentile_year,type,referenced_works,abstract_inverted_index';

// Several groups of terms, e.g. [["CEO narcissism","narcissistic CEO"],["firm performance","innovation"]]:
// every combination is run as one query ("a" AND "b"), because OpenAlex does not support parentheses,
// and the results are merged by OpenAlex id. maxPerCombo pages through each combination.
export async function searchGroups({ groups, fromYear, toYear, sort, maxPerCombo = 200, scope = 'title_abstract' }) {
  const gs = (groups || []).map((g) => (g || []).map((t) => String(t).trim().replace(/^"|"$/g, '')).filter(Boolean)).filter((g) => g.length);
  if (!gs.length) throw new Error('No search terms');
  let combos = gs[0].map((t) => [t]);
  for (const g of gs.slice(1)) combos = combos.flatMap((c) => g.map((t) => [...c, t]));
  if (combos.length > 24) throw new Error(`${combos.length} term combinations; reduce the terms to 24 combinations or fewer`);
  const seen = new Map(); let total = 0; const queries = [];
  for (const combo of combos) {
    const query = combo.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(' AND ');
    queries.push(query);
    for (let page = 1; (page - 1) * 200 < maxPerCombo; page++) {
      const r = await searchOpenAlex({ query, fromYear, toYear, perPage: Math.min(200, maxPerCombo), page, sort, scope });
      if (page === 1) total += r.total;
      for (const s of r.results) if (!seen.has(s.id)) seen.set(s.id, s);
      if (r.results.length < 200 || seen.size >= 3000) break;
    }
  }
  return { total, unique: seen.size, queries, results: [...seen.values()] };
}

// Resolve DOIs to full records (title, authors, year, venue, citations, references).
export async function resolveDois(dois) {
  const list = [...new Set((dois || []).map(normDoi).filter(Boolean))].slice(0, 50);
  if (!list.length) return [];
  const params = new URLSearchParams({ filter: `doi:${list.join('|')}`, per_page: '50', select: SELECT });
  if (process.env.CONTACT_EMAIL) params.set('mailto', process.env.CONTACT_EMAIL);
  const r = await fetch(`${OPENALEX}/works?${params}`, { headers: { 'user-agent': `epistemapper (${process.env.CONTACT_EMAIL || 'mailto unset'})` } });
  if (!r.ok) throw new Error(`OpenAlex ${r.status}`);
  const j = await r.json();
  return j.results.map(workToStudy);
}

// Local citations: how many papers in the corpus cite each paper. Needs OpenAlex ids or DOIs.
export function localCitations(studies) {
  const byId = new Map(studies.map((s) => [s.id, s]));
  for (const s of studies) s.local_cites = 0;
  for (const s of studies) for (const ref of s.references || []) { const t = byId.get(ref); if (t && t !== s) t.local_cites += 1; }
  return studies;
}

// ---- Exports (bibliometrix-compatible) -------------------------------------------------------
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function fromScopusCsv(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names) => head.findIndex((h) => names.includes(h));
  const iT = col(['title']), iA = col(['authors', 'author full names']), iY = col(['year']), iD = col(['doi']), iC = col(['cited by']), iS = col(['source title']), iAb = col(['abstract']);
  if (iT < 0) throw new Error('Not a Scopus CSV export (no Title column)');
  return rows.slice(1).map((r, n) => studyRecord({ id: r[iD] ? `doi:${normDoi(r[iD])}` : `scopus:${n}`, doi: normDoi(r[iD]), title: r[iT], authors: r[iA] || '', year: Number(r[iY]) || null, venue: r[iS] || '', cited_by: Number(r[iC]) || 0, abstract: r[iAb] || '', source: 'scopus' }));
}

function fromWosTab(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const head = lines[0].split('\t');
  const idx = (k) => head.indexOf(k);
  const iT = idx('TI'), iA = idx('AU'), iY = idx('PY'), iD = idx('DI'), iC = idx('TC'), iS = idx('SO'), iAb = idx('AB');
  if (iT < 0) throw new Error('Not a Web of Science tab-delimited export (no TI column)');
  return lines.slice(1).map((l, n) => { const r = l.split('\t'); return studyRecord({ id: r[iD] ? `doi:${normDoi(r[iD])}` : `wos:${n}`, doi: normDoi(r[iD]), title: r[iT], authors: (r[iA] || '').replace(/;/g, ','), year: Number(r[iY]) || null, venue: r[iS] || '', cited_by: Number(r[iC]) || 0, abstract: r[iAb] || '', source: 'wos' }); });
}

function fromBibtex(text) {
  const out = [];
  for (const m of text.matchAll(/@\w+\s*\{[^,]*,([\s\S]*?)\n\}/g)) {
    const f = {};
    for (const fm of m[1].matchAll(/(\w+)\s*=\s*(\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\d+))/g)) f[fm[1].toLowerCase()] = (fm[3] ?? fm[4] ?? fm[5] ?? '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
    if (!f.title) continue;
    out.push(studyRecord({ id: f.doi ? `doi:${normDoi(f.doi)}` : `bib:${out.length}`, doi: normDoi(f.doi), title: f.title, authors: (f.author || '').replace(/ and /g, ', '), year: Number(f.year) || null, venue: f.journal || f.booktitle || '', cited_by: Number(f['note'] && /cited by (\d+)/i.exec(f.note)?.[1]) || null, abstract: f.abstract || '', source: 'bibtex' }));
  }
  if (!out.length) throw new Error('No BibTeX entries found');
  return out;
}

export function parseExport(text, filename = '') {
  const t = String(text);
  if (/^\s*@\w+\s*\{/.test(t)) return fromBibtex(t);
  if (/^﻿?(FN |PT\t|TI\t|AU\t)/.test(t) || t.split('\n')[0].split('\t').includes('TI')) return fromWosTab(t);
  if (/\.bib$/i.test(filename)) return fromBibtex(t);
  return fromScopusCsv(t);
}

// Merge new studies into the corpus by DOI / id without duplicates.
export function mergeStudies(existing, incoming) {
  const key = (s) => s.doi ? `doi:${s.doi}` : s.id;
  const seen = new Map(existing.map((s) => [key(s), s]));
  let added = 0;
  for (const s of incoming) { if (seen.has(key(s))) continue; existing.push(s); seen.set(key(s), s); added++; }
  return added;
}
