# Coverage Map

**An AI-enabled instrument for mapping the diagnostic coverage of replication across a field.**

Replications are usually counted per paper. Coverage Map records something more useful: for each core claim in a field, *which of its assumptions* the existing studies and replications have actually varied, and which remain untested. The result is a coverage map (claims × assumptions) whose empty cells show where the next test would be most informative.

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

## The six steps

1. **Corpus.** Search OpenAlex (phrases in quotes; OR / AND / NOT) or upload a Web of Science / Scopus / BibTeX export. Sort by citations, citations per year (age-adjusted) or year; reviews are flagged; local citation counts show bibliographic coupling. A person marks the core empirical studies.
2. **Studies.** Upload each core study's PDF. The model classifies the paper (empirical, conceptual, review), extracts its predictions, the design used to test each one, the result, and the analytical choices, each with a verbatim quote and page. PDFs are read once and not stored.
3. **Predictions.** On import, the model proposes which of the paper's predictions are the same as ones already in the map (same constructs and direction; different measures are design choices, not different predictions). A person confirms, edits, merges or rejects, and marks the **core** predictions: those that recur and that later work builds on.
4. **Design map.** For each core prediction, a table of the nine dimensions × the options used across studies, with each study's result. Dimensions with several options and mixed results are the design decisions that matter.
5. **Choice space.** The analytical choices found across papers, and the benchmark against a reference list (the Berchicci & King 2022 window of model uncertainty is built in): found, missed, added.
6. **Export.** Core predictions, the design decisions ranked (mixed results first), a JSON of the field, and a CSV of prediction × study × design for R or Python.

An **AI coach** sits beside every step, as in Replication Navigator: it streams short, answer-first replies, sees the field's predictions, tests and designs (not the PDFs), may only use the 322 evidence cards, cites card ids that the server validates, and lets users open the cited card or flag a citation. Every AI proposal is created with status `ai` and must be confirmed by a person.

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

A field is one JSON document (`schema: 2`): `studies[]` (with `paper_type`, `cites_per_year`, `is_review`), `predictions[]` (text X → Y, statement, kind main/moderation/mediation/null, direction, core, builds_on, sources, quote, page, status), `tests[]` (prediction × study: `design{data_source, sample, period, iv_measure, dv_measure, estimator, controls[], functional_form, identification}`, `result{direction, support, statistic, quote, page}`, robustness, status), `choices[]`, `reference[]`, `matches[]`, `notes`; the v0.1 arrays `claims[]`, `assumptions[]`, `coverage[]` are kept for older fields. Saves use optimistic versioning so two people can work on the same field.

## Benchmarks

`knowledge/benchmarks/berchicci-king-2022.json` paraphrases the window of model uncertainty in Berchicci & King (2022), Section 3.1, as 19 reference choices across the six SMJ studies of the SP–FP link. Use it in step 5 to benchmark the AI's choice extraction (demonstrator D2 in the Organization Science proposal).

## License

Code: MIT. Evidence cards: CC BY 4.0 (quoted excerpts remain their authors' copyright). No PDFs are stored in the repository.
