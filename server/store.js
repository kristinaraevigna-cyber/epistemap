// Each field is one JSON document (studies, claims, assumptions, coverage, choices, decisions).
// Stored in Postgres (Supabase) when DATABASE_URL is set, otherwise in ./data/fields/<id>.json.
// Keeping a field as one document makes exports trivial and every save atomic.
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

let pool = null;
const dir = path.resolve(process.env.DATA_DIR || './data/fields');
const eventsFile = path.resolve(process.env.DATA_DIR || './data', 'events.jsonl');

export let storeMode = 'files';
export async function initStore() {
  if (process.env.DATABASE_URL) {
    try {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, max: 3 });
    pool.on('error', (e) => console.error('[store] pool error', e.message));
    await pool.query(`CREATE TABLE IF NOT EXISTS cm_fields (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      doc JSONB NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS cm_events (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      field_id TEXT,
      type TEXT NOT NULL,
      payload JSONB)`);
    // Supabase exposes public tables through its REST API; RLS with no policies blocks that while
    // this server (table owner) keeps full access.
    await pool.query('ALTER TABLE cm_fields ENABLE ROW LEVEL SECURITY');
    await pool.query('ALTER TABLE cm_events ENABLE ROW LEVEL SECURITY');
    storeMode = 'postgres';
    console.log('[store] using Postgres');
    return;
    } catch (e) {
      // Typical cause on Render: the direct Supabase host (db.<ref>.supabase.co) is IPv6-only, which Render
      // cannot reach. Use the Session pooler string (aws-0-<region>.pooler.supabase.com:5432) instead.
      console.error(`[store] Postgres unavailable (${e.code || e.message}); falling back to JSON files. Fields saved now will NOT persist across restarts on Render. Check DATABASE_URL: use the Supabase Session pooler string.`);
      try { await pool?.end(); } catch {}
      pool = null;
    }
  }
  {
    await mkdir(dir, { recursive: true });
    console.log(`[store] using ${dir}`);
  }
}

export function newField(name, description = '') {
  return { id: randomUUID(), name, description, created: new Date().toISOString(), schema: 3, inquiry: { statement: '', terms: '', seeds: '', priors: '' }, assumptions_by_prediction: {}, decisions: {}, loops: [], studies: [], predictions: [], tests: [], claims: [], assumptions: [], coverage: [], choices: [], reference: [], matches: [], notes: '' };
}

export async function listFields() {
  if (pool) {
    const { rows } = await pool.query('SELECT id, name, version, updated_at, jsonb_array_length(doc->\'studies\') AS studies, jsonb_array_length(doc->\'claims\') AS claims FROM cm_fields ORDER BY updated_at DESC');
    return rows.map((r) => ({ id: r.id, name: r.name, version: r.version, updated: r.updated_at, studies: Number(r.studies), predictions: Number(r.predictions), claims: Number(r.claims) }));
  }
  const out = [];
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.json')) continue;
    const d = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
    out.push({ id: d.id, name: d.name, version: d.version || 1, updated: d.updated || d.created, studies: d.studies.length, predictions: (d.predictions || []).length, claims: d.claims.length });
  }
  return out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

const migrate = (d) => d ? { predictions: [], tests: [], inquiry: { statement: '', terms: '', seeds: '', priors: '' }, assumptions_by_prediction: {}, decisions: {}, loops: [], ...d, schema: 3 } : d;
export async function getField(id) {
  if (pool) {
    const { rows } = await pool.query('SELECT doc, version FROM cm_fields WHERE id = $1', [id]);
    return rows[0] ? migrate({ ...rows[0].doc, version: rows[0].version }) : null;
  }
  try { return migrate(JSON.parse(await readFile(path.join(dir, `${id}.json`), 'utf8'))); } catch { return null; }
}

// Optimistic concurrency: a save must carry the version it was loaded with.
export async function saveField(doc, expectedVersion) {
  const next = (expectedVersion || 0) + 1;
  doc.updated = new Date().toISOString();
  if (pool) {
    const { rowCount } = await pool.query(
      `INSERT INTO cm_fields (id, name, doc, version) VALUES ($1, $2, $3, 1)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, doc = EXCLUDED.doc, version = cm_fields.version + 1, updated_at = now()
       WHERE cm_fields.version = $4`, [doc.id, doc.name, { ...doc, version: undefined }, expectedVersion || 0]);
    if (!rowCount) throw Object.assign(new Error('This field was changed by someone else. Reload and try again.'), { status: 409 });
    return next;
  }
  const cur = await getField(doc.id);
  if (cur && (cur.version || 1) !== (expectedVersion || 1) && expectedVersion) throw Object.assign(new Error('This field was changed by someone else. Reload and try again.'), { status: 409 });
  doc.version = cur ? (cur.version || 1) + 1 : 1;
  await writeFile(path.join(dir, `${doc.id}.json`), JSON.stringify(doc, null, 1));
  return doc.version;
}

export async function deleteField(id) {
  if (pool) { await pool.query('DELETE FROM cm_fields WHERE id = $1', [id]); return; }
  try { await unlink(path.join(dir, `${id}.json`)); } catch {}
}

export async function logEvent(fieldId, type, payload) {
  try {
    if (pool) await pool.query('INSERT INTO cm_events (field_id, type, payload) VALUES ($1, $2, $3)', [fieldId || null, type, payload || {}]);
    else await writeFile(eventsFile, JSON.stringify({ ts: new Date().toISOString(), field_id: fieldId || null, type, payload: payload || {} }) + '\n', { flag: 'a' });
  } catch (e) { console.error('[store] log failed', e.message); }
}

export async function exportAll() {
  if (pool) {
    const f = await pool.query('SELECT doc, version FROM cm_fields ORDER BY updated_at');
    const e = await pool.query('SELECT ts, field_id, type, payload FROM cm_events ORDER BY id');
    return { fields: f.rows.map((r) => ({ ...r.doc, version: r.version })), events: e.rows };
  }
  const fields = [];
  for (const f of await readdir(dir)) if (f.endsWith('.json')) fields.push(JSON.parse(await readFile(path.join(dir, f), 'utf8')));
  let events = [];
  try { events = (await readFile(eventsFile, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  return { fields, events };
}
