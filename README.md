# Evidence Atlas

**An AI-enabled instrument for epistemic mapping.** Map what a field has tested and what each test assumed, judge what the field takes for granted, and decide what to test next: a multiverse on existing data (alone or allocated to analyst teams through the map), or a new study planned in Replication Navigator. The result returns to the map.

An *epistemic map* is a correspondence between sets of assumptions and the evidence obtained under each (King, Goldfarb & Simcoe, 2021, *AMR*); Goldfarb & Yan (2021, *SMJ*) show what it does for a replication. Evidence Atlas builds the map from the literature (steps 0–5), then turns it into a specification list and allocates it to teams (step 7), so the researcher is the cartographer and the judgments stay in the legend.

*Formerly Coverage Map (v0.1–v0.3).*

Replications are usually counted per paper. Evidence Atlas records something more useful: for each core claim in a field, *which of its assumptions* the existing studies and replications have actually varied, and which remain untested. The result is a coverage map (claims × assumptions) whose empty cells show where the next test would be most informative.

This is a separate project from [Replication Navigator](https://github.com/kristinaraevigna-cyber/replication-navigator) (single-study planning). It reuses the Navigator's verified evidence base but shares no code, so the two can evolve independently.

## What it maps (v0.2: empirical focus)

The unit is the **prediction** (X → Y, direction, at the construct level): what a study set out to test, not what it found. For every prediction the map records each **test** of it, described on nine research-design dimensions, with the result:

| Dimension | Question |
|---|---|
| Data source | Which dataset(s) provided the observations? |
| Sample and level | Which population, unit of analysis and restrictions? |
| Period and context | Which years, countries, industries, settings? |
| Measure of X | How was the predictor operationalised? |
| Measure of Y | How was the outcome operationalised? |
| Estimator and variance | Which estimator; between- or within-unit variance? |
| Controls and fixed effects | Which controls and fixed effects? |
| Functional form and timing | Linear, curvilinear, moderated; lags? |
| Identification strategy | How is causality or endogeneity addressed? |

Lined up across studies, this shows which predictions **recur** (core), which design decisions **differ** between studies, and where the **results disagree**. Those are the inputs to a multiverse or specification map (Berchicci & King, 2022; Götz et al., 2026), and the design decisions a next test should vary. The earlier assumption-based decomposition (theory, constructs, design, analysis, context) remains in the evidence base as a secondary, conceptual lens.

## Human in the loop (v0.3)

The human goes first and disposes last. Step 0 records the researcher's inquiry (what they want to understand, search terms, seed studies, what they think the field takes for granted); every later step is "the tool proposes, the human disposes"; and three loops let the person send the tool back (revise the search, add studies it should weigh, add a prediction or assumption from their own reading). Step 5 is a judgment step rather than a confirmation: the tool unearths the assumptions the designs rest on and rates their sensitivity; the person judges each as reasonable, questionable or violated and decides, per prediction, between a multiverse on existing data, a new study with a different design, both, or stopping. Decisions, judgments, loops and coach use are logged (with consent) so the study of the instrument can ask when human judgment changed the outcome.

## The ten steps

0. **Your inquiry.** The researcher states the question, search terms (dictation supported where the browser allows it), seed studies and what they suspect the field takes for granted. The suspicions are *sealed*: no extraction, unearthing, alternatives or assessment call sees them, so the model cannot echo them; step 5 compares them adversarially with what was unearthed blind (supported / contradicted / not addressed), and the coach is told to treat them as hypotheses to test.
1. **Corpus.** Search OpenAlex with two groups of terms (matched in title and abstract by default; full text is optional because it pulls in methods papers that merely mention a term) (every "first term" AND "second term" combination is searched and merged, because OpenAlex has no parentheses; a raw AND/OR/NOT query is available under Advanced; fetch 50–200 results or all matches up to 3,000), add studies by DOI (the citation is filled in from OpenAlex), or upload a Web of Science / Scopus / BibTeX export. Sort by citations, citations per year (age-adjusted) or year; reviews are flagged; local citation counts show bibliographic coupling. A person marks the core empirical studies.
2. **Studies.** Attach a PDF to any study (from step 1 or 2). The model classifies the paper (empirical, conceptual, review), lists its studies (Study 1, Study 2…), and extracts its predictions in all their forms (hypotheses, propositions, research questions, stated predictions, including ones that open a later results section), the design of each test per study, the result, and the analytical choices, each with a verbatim quote and page. Reviews yield the predictions they report as tested, flagged `from_review`. PDFs are read once and not stored.
3. **Predictions.** Confirming says the extraction is correct; a separate ★ Core button chooses what to map. "Which of these match my inquiry?" asks the model to sort predictions into core / related / outside relative to the step-0 inquiry (the person still decides; one click rejects the outside ones; rejected items are hidden but kept). On import, the model proposes which of the paper's predictions are the same as ones already in the map (same constructs and direction; different measures are design choices, not different predictions). A person confirms, edits, merges or rejects, and marks the **core** predictions: those that recur and that later work builds on.
4. **Design map.** The first half of the epistemic map. For each core prediction, a table of the nine dimensions × the options used across studies, with each study's result. Dimensions with several options and mixed results are the design decisions that matter.
5. **Assumptions and decision.** For each core prediction the tool unearths the hidden assumptions behind the designs (with sensitivity, what would relax each, evidence-card grounding, design options no study has used, possible overlaps); the person judges each. "Challenge my judgments" makes the tool argue the other side of each judgment where a methodologist would (an assumption every study shares and rates as decisive, judged reasonable, gets a challenge; a violated one the designs do address gets a defence), with what evidence would change its view; the person keeps or changes each judgment, or takes it to the coach, and both outcomes are logged (`after_challenge: kept | changed`). When every assumption is judged reasonable the step nudges toward the challenge. Colleagues can judge the same assumptions independently through a per-person link that hides everyone else's verdicts; their judgments appear beside the owner's with the agreement per assumption, and `judgments.csv` exports all of them (the inter-rater data for demonstrator D1). "Assess from my judgments" then asks the model for a route assessment that starts explicitly from those judgments (a multiverse cannot repair a design flaw shared by all studies), and the person decides: multiverse on existing data (→ step 7), replication of a specific study (→ Replication Navigator), both, a new design (recorded with the violated assumptions as the brief; de novo design support is a planned extension), or stop. Steps 7–9 then show a banner with each prediction's route and say when a step is optional for it; the sidebar marks the multiverse steps as "your route" or "optional for your decision".
6. **Choice space.** The analytical choices found across papers, one table per category with the studies as columns so differences between studies are visible at a glance (a by-study view remains); confirmed choices can be turned into the field's own reference list, and the benchmark against a reference list (the Berchicci & King 2022 window of model uncertainty is built in): found, missed, added.
7. **Multiverse.** For a core prediction: the assumption space (which design dimensions vary, with which options; options from a mistaken study can be left out of the map without touching the record; "Ask the tool to propose alternatives" reads the map and the step-5 judgments and proposes options no study has used, preferring ones that relax a questionable or violated assumption), the legend (where each prior study sits; the step-5 judgments as credibility weights), and the specification list (cap 10,000, with a warning above 1,000: a map is a prioritising tool, and control sets are theoretically motivated options rather than all subsets), downloadable as `specifications-<prediction>.csv`: the multiverse plan.
8. **Many analysts (optional).** An explicit choice: run the map alone and record results, or as a many-analysts study. Why and how to run the map with many analysts (Delios et al., 2025; Silberzahn et al., 2018; Breznau et al., 2022; Huntington-Klein et al., 2021). Add teams and allocate the specifications with a seed: every team runs everything, a random split, one forking dimension per team, or free choice. Each team gets a link to an analyst view with a form per specification; a field owner working alone can add results by hand or upload a CSV of results from R, Python or Stata (the specification list plus `estimate`, `se`, `n` columns). Estimates return as a specification curve, the completed epistemic map, and as `results-<prediction>.csv`.
9. **Reproduce, replicate, export.** Decisions with their reasons; hand-off to Replication Navigator (whose reproduction stage generates analysis code from the original paper and whose later stages plan a preregistered replication); JSON and CSV for a multiverse.

An **AI coach** sits beside every step, as in Replication Navigator: it streams short, answer-first replies, sees the field's predictions, tests and designs and the researcher's own step-5 judgments and decisions (not the PDFs), and is told to build its advice on those judgments and say so, may only use the 333 evidence cards, cites card ids that the server validates, and lets users open the cited card or flag a citation. Every AI proposal is created with status `ai` and must be confirmed by a person.

## Running locally

```bash
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY
npm run dev              # http://localhost:3000
```

Node 20 or later; no build step. Without `DATABASE_URL`, fields are stored as JSON files in `data/fields/`.

Tests: `npm test` (API, against a mock model) and `node test/e2e.mjs` (browser walk-through; needs Playwright).

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md): GitHub → Render (Blueprint from `render.yaml`) → Supabase Postgres for shared fields.

## Configuration

| variable | default | meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | server key for reading papers |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` | model id |
| `DATABASE_URL` | — | Postgres (Supabase session pooler); if empty, JSON files |
| `ADMIN_TOKEN` | — | required for `/api/admin/export` (all fields and events) |
| `ACCESS_CODE` | — | optional: required to create, edit and run the model; leave empty for open access |
| `CONTACT_EMAIL` | — | sent to OpenAlex for the polite pool |
| `MAX_PDF_MB` | `25` | largest PDF accepted |
| `DAILY_MODEL_CAP` | `400` | model calls per day on the server key (extraction, tagging, comparison and coach) |
| `COACH_PER_HOUR` | `60` | coach messages per session per hour on the server key |
| `COACH_MAX_TOKENS` | `1200` | maximum length of a coach reply |
| `NAVIGATOR_URL` | — | public URL of a Replication Navigator deployment; adds “Plan this test” links from untested assumptions that open the Navigator with the claim, the assumption to vary and the original study pre-filled |

## Hand-off to Replication Navigator

Every core prediction (steps 4 and 6) and every design dimension that varies across studies carries a **Plan this test →** link when `NAVIGATOR_URL` is set. It opens Replication Navigator with `?plan=<base64 JSON>`; the Navigator pre-fills the target study and the prediction (stage 1), the existing evidence and design range, and the aim (stage 2): which design decision to vary. The researcher plans, preregisters and runs the test there; the finished study is then read into the map in step 2 like any other.

## Data model

A field is one JSON document (`schema: 4`): `space{}` (assumption space per prediction), `teams[]`, `allocation{}`, `runs[]` (submitted results), plus `studies[]` (with `paper_type`, `cites_per_year`, `is_review`), `predictions[]` (text X → Y, statement, kind main/moderation/mediation/null, direction, core, builds_on, sources, quote, page, status), `tests[]` (prediction × study: `design{data_source, sample, period, iv_measure, dv_measure, estimator, controls[], functional_form, identification}`, `result{direction, support, statistic, quote, page}`, robustness, status), `choices[]`, `reference[]`, `matches[]`, `notes`; the v0.1 arrays `claims[]`, `assumptions[]`, `coverage[]` are kept for older fields. Saves use optimistic versioning so two people can work on the same field.

## Benchmarks

`knowledge/benchmarks/berchicci-king-2022.json` paraphrases the window of model uncertainty in Berchicci & King (2022), Section 3.1, as 19 reference choices across the six SMJ studies of the SP–FP link. Use it in step 5 to benchmark the AI's choice extraction (demonstrator D2 in the Organization Science proposal).

## License

Code: MIT. Evidence cards: CC BY 4.0 (quoted excerpts remain their authors' copyright). No PDFs are stored in the repository.
