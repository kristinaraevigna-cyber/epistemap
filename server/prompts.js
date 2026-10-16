// Prompts for the three model steps. Every output item carries a verbatim quote and page so a
// human can check it; items are created with status "ai" and must be confirmed by a person.

export const EXTRACT_PROMPT = `You are reading one empirical paper for a field-level map of diagnostic coverage. Extract ONLY what the paper states. Do not evaluate, do not guess, use null when something is not reported. Every item needs a short verbatim quote (8–30 words) and the page it appears on, so a reader can verify it.

Work in three parts.

PART 1 — CLAIMS. List the paper's core empirical claims (usually 1–4): the relationships it tests and reports as findings. Write each claim as one plain sentence of the form "X is associated with / causes Y (direction)". Mark the main claim.

PART 2 — ASSUMPTIONS. For each claim, list the consequential assumptions on which the reported result rests, in five dimensions:
- theory: the mechanism or causal story, and rival explanations that the design does or does not rule out
- constructs: how each key concept is operationalised and whether the measure captures it
- design: sample, data source, time window, design (cross-sectional, panel, experiment), statistical power
- analysis: model specification, controls, fixed effects, exclusions, transformations, lags, estimators
- context: country, period, industry, institutional setting
For each assumption give: the assumption in one sentence (what must be true for the result to carry its interpretation); dimension; consequentiality 1–3 (3 = if this assumption fails, the claim's interpretation changes; 1 = minor); whether the paper itself varied or tested it (varied: "yes" | "partly" | "no"), with how; a quote; a page.

PART 3 — ANALYSIS CHOICES. List every analytical decision the authors made or mention as an alternative (sample restrictions, variable definitions, controls, model type, fixed effects, clustering, lags, outlier handling, winsorisation, subsamples, robustness checks). For each: category; description; the options considered or reported (the chosen one first); whether the result was reported for alternatives; quote; page.

Return ONLY a JSON object:
{
  "citation": "APA reference with DOI if shown",
  "summary": "two sentences: what the paper tests and what it finds",
  "data_source": "datasets used, with years and countries",
  "claims": [
    { "key": "c1", "text": "...", "main": true, "effect": "key statistic or effect size as reported, or null", "quote": "...", "page": 3,
      "assumptions": [
        { "key": "c1-a1", "dimension": "theory|constructs|design|analysis|context", "text": "...", "consequential": 1, "varied": "yes|partly|no", "how": "... or null", "quote": "...", "page": 5 }
      ] }
  ],
  "choices": [
    { "key": "ch1", "category": "sample|variables|controls|model|estimation|exclusions|robustness|other", "description": "...", "options": ["chosen", "alternative"], "alternatives_reported": true, "quote": "...", "page": 7 }
  ]
}`;

export const TAG_PROMPT = `You are checking which assumptions of an existing claim a paper has tested. You will receive (a) the claim and its list of assumptions, each with an id, and (b) a paper (attached). For EACH assumption id, say whether this paper deliberately varied, tested or relaxed that assumption, compared with the original study the claim comes from.

Rules: use ONLY what the paper states; "varied" means the paper changed or tested that assumption (a different measure, sample, period, specification, mechanism test), not merely mentioned it; if the paper did not vary it, say "no" and leave how/quote null; every "yes" or "partly" needs a verbatim quote (8–30 words) and page; give the result for that assumption: "supports" (the claim held under the variation), "contradicts", "mixed", or "na".

Return ONLY a JSON object:
{ "citation": "APA reference of the attached paper", "tags": [ { "assumption": "<id>", "varied": "yes|partly|no", "how": "...|null", "result": "supports|contradicts|mixed|na", "quote": "...|null", "page": 4 } ] }`;

export const COMPARE_PROMPT = `You are aligning two lists of analytical choices for the same set of studies: list R (a published reference map, written by human researchers) and list A (produced by an AI from the papers). For each item in R, find the item(s) in A that describe the same choice (same decision, even if worded differently). Return ONLY a JSON object:
{ "matches": [ { "r": "<R key>", "a": ["<A key>", ...], "confidence": "high|medium|low", "note": "one short phrase on the match or mismatch" } ], "added": [ "<A keys not covered by any R item>" ] }
An R item with no match has "a": []. Do not invent keys.`;

export function parseJsonLoose(text) {
  const s = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON in model output');
  return JSON.parse(s.slice(start, end + 1));
}
