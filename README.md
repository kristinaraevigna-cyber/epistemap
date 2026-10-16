# Coverage Map

**An AI-enabled instrument for mapping the diagnostic coverage of replication across a field.**

Replications are usually counted per paper. Coverage Map records something more useful: for each core claim in a field, *which of its assumptions* the existing studies and replications have actually varied, and which remain untested. The result is a coverage map (claims × assumptions) whose empty cells show where the next test would be most informative.

This is a separate project from [Replication Navigator](https://github.com/kristinaraevigna-cyber/replication-navigator) (single-study planning). It reuses the Navigator's verified evidence base but shares no code, so the two can evolve independently.

## The idea in one table

| Dimension | Question the assumption answers | Grounding |
|---|---|---|
| Theory | Does the proposed mechanism hold, and do rival explanations predict the same result? | Irvine (2021); Anderson & Maxwell (2016) |
| Constructs | Do the results depend on how the concepts were operationalised? | Flake et al. (2022) |
| Design and sample | Do they depend on the sample, data source, time window or design? | Brandt et al. (2014); Bonett (2021) |
| Analysis | Do they hold across reasonable analytical choices? | Götz et al. (2026); Berchicci & King (2022) |
| Context | Do they generalise to other periods, countries and settings? | Delios et al. (2022) |

**Diagnostic coverage** of a claim = the share of its consequential assumptions that at least one study has deliberately varied (reported unweighted and weighted by consequentiality).

## The six steps

1. **Corpus.** Search OpenAlex (open, no account) or upload a Web of Science / Scopus / BibTeX export (the formats bibliometrix reads). Local citation counts help identify core studies. A person marks the core set.
2. **Studies.** Upload each core study's PDF. The model extracts the claims, the assumptions behind each claim in the five dimensions, and the analytical choices, each with a verbatim quote and page number. PDFs are read once and not stored.
3. **Claims and assumptions.** A person confirms, edits or rejects every item. Only confirmed items enter the map.
4. **Coverage map.** Tag further studies (replications, extensions) against a claim: the model proposes which assumptions each study varied, with quotes; a person confirms. The map shows covered, partly covered and untested assumptions, ordered by consequentiality.
5. **Choice space.** The analytical choices found across the papers form the choice space for a multiverse. Paste a reference list (the Berchicci & King 2022 window of model uncertainty ships as a built-in benchmark) and align it with what the AI found: found, missed, added.
6. **Export.** JSON of the whole field (re-importable), a CSV of assumption × study rows for R or Python, and a list of the most informative next tests.

An **AI coach** sits beside every step, as in Replication Navigator: it streams short, answer-first replies, sees the field's claims, assumptions and coverage (not the PDFs), may only use the 322 evidence cards, cites card ids that the server validates, and lets users open the cited card or flag a citation. Every AI proposal is created with status `ai` and must be confirmed by a person. The model is grounded in the same 322 verified evidence cards as Replication Navigator (`knowledge/evidence-cards.json`; `scripts/verify_cards.py` checks every quote against its PDF page).

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

Every untested assumption in the coverage map (step 4) and in the next-tests list (step 6) carries a **Plan this test →** link when `NAVIGATOR_URL` is set. It opens Replication Navigator with `?plan=<base64 JSON>`; the Navigator pre-fills the target study and claim (stage 1) and the aim (stage 2) with the assumption to vary, and records the hand-off. The researcher then plans, preregisters and runs the test there; the result is returned to the map by tagging the new study in step 4.

## Data model

A field is one JSON document: `studies[]`, `claims[]`, `assumptions[]` (dimension, consequential 1–3, quote, page, status), `coverage[]` (assumption × study: varied yes/partly/no, how, result, quote, page, status, origin), `choices[]`, `reference[]`, `matches[]`, `notes`. Saves use optimistic versioning so two people can work on the same field.

## Benchmarks

`knowledge/benchmarks/berchicci-king-2022.json` paraphrases the window of model uncertainty in Berchicci & King (2022), Section 3.1, as 19 reference choices across the six SMJ studies of the SP–FP link. Use it in step 5 to benchmark the AI's choice extraction (demonstrator D2 in the Organization Science proposal).

## License

Code: MIT. Evidence cards: CC BY 4.0 (quoted excerpts remain their authors' copyright). No PDFs are stored in the repository.
