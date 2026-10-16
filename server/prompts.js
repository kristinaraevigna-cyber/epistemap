// Prompts for the model steps. Every output item carries a verbatim quote and page so a person can
// check it; items are created with status "ai" and must be confirmed by a person.
//
// v0.2 focus: PREDICTIONS (what the paper set out to test) and RESEARCH DESIGNS (how it tested
// them), across studies. Findings are recorded as the result of a test, never as the claim.

export const DESIGN_FIELDS = ['data_source', 'sample', 'period', 'iv_measure', 'dv_measure', 'estimator', 'controls', 'functional_form', 'identification'];

export const EXTRACT_PROMPT = `You are reading one paper for a field-level map of predictions and the research designs used to test them. Extract ONLY what the paper states. Do not evaluate, do not guess; use null when something is not reported. Every item needs a short verbatim quote (8–30 words) and the page it appears on.

PART 0 — PAPER TYPE. Classify: "empirical" (reports new data analysis), "conceptual" (theory or propositions without new data), "review" (literature review or meta-analysis), "methods", "other".

PART 1 — PREDICTIONS. List the predictions the paper sets out to test or proposes (hypotheses, propositions, research questions turned into expected relationships). Write each as one sentence of the form "X → Y (direction)" plus a plain statement, e.g. "CEO narcissism → firm risk-taking (positive)". Rules:
- A prediction is what the authors expected BEFORE seeing the data, not the result. If the paper states hypotheses, use them (keep their labels, e.g. H1). If it has no hypotheses (abductive or exploratory), state the relationship it set out to examine at the level of the constructs, e.g. "TMT gender diversity → firm performance (positive)", NOT at the level of specific measures or results.
- Keep predictions at the construct level. Different measures of the same construct are design choices, not different predictions.
- Mark the 1–3 predictions that the paper's contribution rests on as "core": true. Mark whether each is a main effect, a moderation (boundary condition), a mediation (mechanism), or a null/no-effect prediction.
- Note which earlier work the prediction builds on, if the paper says so ("builds_on": short citation strings as written in the paper, or []).

PART 2 — TESTS. For EACH prediction that the paper tests empirically, describe the research design used to test it, with these fields (null if not reported): data_source; sample (population, unit of analysis, N, restrictions); period (years, countries, industries, settings); iv_measure (how X was operationalised); dv_measure (how Y was operationalised); estimator (model and whether between- or within-unit variance is used); controls (list of control variables and fixed effects); functional_form (linear, curvilinear, interactions, lags); identification (how endogeneity or causality is handled, or "none"). Then the result: direction found ("positive" | "negative" | "null" | "mixed"), whether it was statistically supported ("supported" | "not supported" | "partly"), the key statistic or effect size as reported, quote, page. If a prediction is tested with several specifications, give the main one and list the alternatives under "robustness" (short strings).

PART 3 — ANALYTICAL CHOICES. List every analytical decision the authors made or mention as an alternative (sample restrictions, variable definitions, controls, model type, fixed effects, clustering, lags, outlier handling, winsorisation, subsamples, robustness checks). For each: category; description; the options considered (chosen first); whether results for alternatives were reported; quote; page.

Return ONLY a JSON object:
{
  "citation": "APA reference with DOI if shown",
  "paper_type": "empirical|conceptual|review|methods|other",
  "summary": "two sentences: what the paper set out to test and what it found",
  "predictions": [
    { "key": "p1", "label": "H1 or null", "text": "X → Y (direction)", "statement": "one plain sentence", "x": "construct X", "y": "construct Y", "direction": "positive|negative|null|conditional", "kind": "main|moderation|mediation|null", "core": true, "builds_on": [], "quote": "...", "page": 4,
      "test": { "data_source": "...", "sample": "...", "period": "...", "iv_measure": "...", "dv_measure": "...", "estimator": "...", "controls": ["..."], "functional_form": "...", "identification": "...", "result_direction": "positive", "support": "supported", "statistic": "b = 0.12, p < .01", "robustness": ["firm fixed effects"], "quote": "...", "page": 12 } }
  ],
  "choices": [
    { "key": "ch1", "category": "sample|variables|controls|model|estimation|exclusions|robustness|other", "description": "...", "options": ["chosen", "alternative"], "alternatives_reported": true, "quote": "...", "page": 7 }
  ]
}
For a conceptual or review paper, "test" is null for every prediction and "choices" may be empty.`;

export const CONSOLIDATE_PROMPT = `You are consolidating predictions across studies in one field. You will receive list C (canonical predictions already in the map, each with an id) and list N (new predictions extracted from one paper, each with a key). For each item in N, decide whether it states the SAME prediction as an item in C: same constructs X and Y at the construct level and compatible direction, even if worded differently or measured differently. Different measures of the same construct are the same prediction. A moderation or mediation of the same X → Y is a DIFFERENT prediction from the main effect.
Return ONLY a JSON object: { "map": [ { "n": "<N key>", "c": "<C id or null>", "confidence": "high|medium|low", "note": "short phrase" } ] }
Do not invent keys or ids.`;

export const COMPARE_PROMPT = `You are aligning two lists of analytical choices for the same set of studies: list R (a published reference map, written by human researchers) and list A (produced by an AI from the papers). For each item in R, find the item(s) in A that describe the same choice (same decision, even if worded differently). Return ONLY a JSON object:
{ "matches": [ { "r": "<R key>", "a": ["<A key>", ...], "confidence": "high|medium|low", "note": "one short phrase on the match or mismatch" } ], "added": [ "<A keys not covered by any R item>" ] }
An R item with no match has "a": []. Do not invent keys.`;

export function parseJsonLoose(text) {
  const s = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON in model output');
  return JSON.parse(s.slice(start, end + 1));
}
