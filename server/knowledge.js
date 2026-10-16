// Loads the evidence base and builds the grounding blocks sent to the model.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'knowledge');
const load = (f) => JSON.parse(readFileSync(path.join(root, f), 'utf8'));

export const cards = load('evidence-cards.json');
export const sources = load('sources.json');
export const dimensions = load('dimensions.json');
import { readdirSync } from 'node:fs';
export const benchmarks = readdirSync(path.join(root, 'benchmarks')).filter((f) => f.endsWith('.json')).map((f) => load(path.join('benchmarks', f)));
export const cardById = new Map(cards.map((c) => [c.id, c]));
export const KNOWLEDGE_VERSION = '0.1.0';

// Cards that ground each dimension: by stage and by source, capped so the prompt stays small.
export function cardsForDimension(dim, limit = 18) {
  const d = dimensions.find((x) => x.id === dim);
  if (!d) return [];
  const score = (c) => (d.card_sources.includes(c.source) ? 2 : 0) + (d.card_stages.includes(c.stage) ? 1 : 0);
  return cards.filter((c) => score(c) > 0).sort((a, b) => score(b) - score(a)).slice(0, limit);
}

export function groundingBlock() {
  const parts = dimensions.map((d) => {
    const cs = cardsForDimension(d.id).map((c) => `  [${c.id}] ${c.title}: ${c.guidance}`).join('\n');
    return `## ${d.name} (${d.id})\nQuestion: ${d.question}\nTypical assumptions: ${d.examples.join('; ')}.\nGrounding (cite ids in brackets):\n${cs}`;
  });
  return `<evidence_base version="${KNOWLEDGE_VERSION}">\nFive dimensions of diagnostic coverage. Each is grounded in evidence cards extracted from the methodological literature; cite card ids in [brackets] when a card supports a decomposition or a judgement of consequentiality.\n\n${parts.join('\n\n')}\n</evidence_base>`;
}

export function extractCitations(text) {
  const ids = new Set();
  for (const m of String(text || '').matchAll(/\[([a-z]+\d{4}-\d{2,3})\]/g)) ids.add(m[1]);
  return [...ids].map((id) => ({ id, valid: cardById.has(id) }));
}
