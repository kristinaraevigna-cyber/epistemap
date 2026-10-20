// Prompts for the model steps. Every output item carries a verbatim quote and page so a person can
// check it; items are created with status "ai" and must be confirmed by a person.
//
// v0.2 focus: PREDICTIONS (what the paper set out to test) and RESEARCH DESIGNS (how it tested
// them), across studies. Findings are recorded as the result of a test, never as the claim.

export const DESIGN_FIELDS = ['data_source', 'sample', 'period', 'iv_measure', 'dv_measure', 'estimator', 'controls', 'functional_form', 'identification'];

export const EXTRACT_PROMPT = `You are reading one paper for a field-level map of predictions and the research designs used to test them. Extract ONLY what the paper states. Do not evaluate, do not guess; use null when something is not reported. Every item needs a short verbatim quote (8–30 words) and the page it appears on.

PART 0 — PAPER TYPE AND STUDIES. Classify the paper: "empirical" (reports new data analysis), "conceptual" (theory or propositions without new data), "review" (literature review, systematic review or meta-analysis), "methods", "other". List the studies it contains ("studies": e.g. ["Study 1", "Study 2"], or ["Main study"] if there is one; a paper that reports one sample but separate results sections for main effects and moderation still has ONE study).

PART 1 — PREDICTIONS. A prediction is anything the paper sets out to test or answer BEFORE seeing the data, in any of these forms: formal hypotheses (H1, H2…), propositions (P1…), research questions (RQ1…, or questions stated in prose such as "we ask whether…", "we examine whether…", "does X affect Y?"), and stated predictions or expectations. Include ALL of them, including ones introduced later in the paper (e.g. a research question that opens a moderation or supplementary section of the results). Papers without formal hypotheses, such as Academy of Management Discoveries papers or abductive studies, still have predictions in this sense: state the relationship(s) the authors set out to examine. Rules:
- Write each as "X → Y (direction)" plus one plain sentence, at the CONSTRUCT level. Different measures of the same construct are design choices, not different predictions. A moderation (boundary condition) or mediation (mechanism) of X → Y is a separate prediction from the main effect.
- Keep the paper's own label (H1, P2, RQ1, or "RQ (moderation section)" when unlabelled) in "label", and the form in "form": "hypothesis" | "proposition" | "research_question" | "prediction" | "exploratory".
- Mark the 1–3 predictions the paper's contribution rests on as "core": true. Mark "kind": main | moderation | mediation | null.
- Note which earlier work the prediction builds on, if the paper says so ("builds_on": short citation strings, or []).
- For a REVIEW or META-ANALYSIS: extract the predictions that the review reports as tested in the literature (its organising relationships), set "from_review": true, and in "test" summarise what the review reports about how they were tested (designs, number of studies, pooled result) rather than a single study's design.

PART 2 — TESTS. For EACH prediction tested with data in this paper, describe each test (one per study if the paper has several studies; use "study_label"): data_source; sample (population, unit of analysis, N, restrictions); period (years, countries, industries, settings); iv_measure; dv_measure; estimator (model; between- or within-unit variance); controls (list incl. fixed effects); functional_form (linear, curvilinear, interactions, lags); identification (how endogeneity or causality is handled, or "none"). Then the result: result_direction ("positive" | "negative" | "null" | "mixed"); support ("supported" | "not supported" | "partly"); the key statistic or effect size; "robustness" (short strings for alternative specifications reported); quote; page.

PART 3 — ANALYTICAL CHOICES. List every analytical decision the authors made or mention as an alternative (sample restrictions, variable definitions, controls, model type, fixed effects, clustering, lags, outliers, winsorisation, subsamples, robustness checks). For each: category; description; options considered (chosen first); whether results for alternatives were reported; quote; page.

Return ONLY a JSON object:
{
  "citation": "APA reference with DOI if shown",
  "paper_type": "empirical|conceptual|review|methods|other",
  "studies": ["Study 1", "Study 2"],
  "summary": "two sentences: what the paper set out to test and what it found",
  "predictions": [
    { "key": "p1", "label": "H1 | RQ1 | P1 | RQ (moderation section) | null", "form": "hypothesis|proposition|research_question|prediction|exploratory", "text": "X → Y (direction)", "statement": "one plain sentence", "x": "construct X", "y": "construct Y", "direction": "positive|negative|null|conditional|open", "kind": "main|moderation|mediation|null", "core": true, "from_review": false, "builds_on": [], "quote": "...", "page": 4,
      "tests": [ { "study_label": "Study 1", "data_source": "...", "sample": "...", "period": "...", "iv_measure": "...", "dv_measure": "...", "estimator": "...", "controls": ["..."], "functional_form": "...", "identification": "...", "result_direction": "positive", "support": "supported", "statistic": "b = 0.12, p < .01", "robustness": ["firm fixed effects"], "quote": "...", "page": 12 } ] }
  ],
  "choices": [
    { "key": "ch1", "category": "sample|variables|controls|model|estimation|exclusions|robustness|other", "description": "...", "options": ["chosen", "alternative"], "alternatives_reported": true, "quote": "...", "page": 7 }
  ]
}
For a conceptual paper, "tests" is [] for every prediction and "choices" may be empty.`;

// Hidden assumptions behind the designs used to test one prediction (the judgment step).
export const ASSUMPTIONS_PROMPT = `You are helping an expert researcher judge the evidence on ONE prediction. You will receive the prediction and the research designs of the studies that tested it (from <tests>). Your task is to UNEARTH the assumptions that these designs rest on: conditions that must hold for the reported results to carry their interpretation, which the papers usually do not state. Typical sources: identification ("none" → no omitted variable bias, no reverse causality, no selection); measures (the proxy captures the construct; ratings providers agree); sample and period (the relationship is stable across the window; the population generalises); estimator (between-firm variance reflects the mechanism; errors are independent); functional form (the relationship is linear; no threshold).

For each assumption give: text (one sentence: what must be true); source (which design dimension(s) it comes from: data_source, sample, period, iv_measure, dv_measure, estimator, controls, functional_form, identification); shared_by (which study labels rest on it: all, or a list); sensitivity (1–3: 3 = if this assumption fails, the direction or existence of the effect is in doubt; 1 = minor); relaxed_by (what design change or test would relax or check it, in one phrase, e.g. "instrument for X", "within-firm estimator", "alternative ratings provider", "new period"); and grounding: evidence-card ids in [brackets] from the evidence base when a card supports the point, otherwise [].
Then two short lists: "gaps" (design options that no study has used but that the literature would consider reasonable, one phrase each) and "overlaps" (predictions in <other_predictions>, if any, that may be the same construct relationship under different names).

Return ONLY a JSON object:
{ "assumptions": [ { "key": "a1", "text": "...", "source": ["identification"], "shared_by": "all", "sensitivity": 3, "relaxed_by": "...", "grounding": ["forrt2025-22"] } ], "gaps": ["..."], "overlaps": [ { "prediction": "<id>", "why": "..." } ] }
Be conservative: 4–10 assumptions, the most consequential first. Do not invent studies or results.`;

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
