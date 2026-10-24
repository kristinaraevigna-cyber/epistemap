# Method notes (v0.4)

These notes record the design decisions behind Evidence Atlas so they can go into the technical appendix of the Organization Science proposal.

## 0. Change of focus in v0.2 (16 October 2026)

After the team reviewed v0.1, the instrument was refocused on empirical work. v0.1 decomposed each claim into assumptions across five dimensions; that produced many one-off, conceptual items and was dominated by reviews and theory papers. v0.2 extracts **predictions** (what a study set out to test, X → Y at the construct level) and the **research design** used in each test, and lines them up across studies. This is the raw material of a multiverse / specification map (Berchicci & King, 2022; Götz et al., 2026): the core predictions, and the range of designs used to test them. The five-dimension lens stays in the evidence base as a secondary, conceptual view.

## 0b. Human first, loops, judgment (v0.3, after the 20 October review)

Three changes from the review. (1) The person goes first: step 0 records the inquiry, search terms, seed studies and priors, and the tool is told to weigh them. (2) Loops: from steps 3–5 the person can send the tool back to revise the search, add studies to weigh, or add their own prediction; each loop is logged with its reason. (3) A judgment step: the tool unearths the assumptions the designs rest on (gap-spotting is the tool's strength; problematisation is the person's), the person judges them, and decides between a multiverse on existing data and a new study with a different design. Predictions now include hypotheses, propositions, research questions and stated predictions, per study within a paper, and reviews are handled as sources of reported predictions.

## 0c. Epistemic maps and teams (v0.4, after the 23 October review)

The team re-anchored the instrument on *epistemic maps* (King, Goldfarb & Simcoe, 2021): a correspondence between sets of assumptions about an empirical model and summaries of the evidence under each. Steps 0–5 build the map as the literature has drawn it (which assumption sets were used, with what result); step 7 completes it. The person fixes the assumption space A for a core prediction (which of the nine dimensions vary, with which options, including alternatives no study has used), reads the legend (where each prior study sits; the step-5 judgments as credibility weights, kept separate from the map as King et al. recommend), and the instrument enumerates the specifications. These can be run as a multiverse, or allocated to analyst teams (every team runs everything, a seeded random split, one forking dimension per team, or free choice); each team works through its own link and submits t(a) per specification; results return to the field as a specification curve and as a database (`runs.csv`). This is the "many analysts" layer discussed in the proposal, in prototype: the map provides the structure, the people provide the estimates, and the allocation and submissions are logged so the study of the instrument can compare teams. Eleven cards from King et al. (2021) and Goldfarb & Yan (2021) were added to the evidence base (quotes verified on page).

## 1. Unit of analysis

The unit is the **prediction–test pair**. A prediction is a hypothesis or proposition (labelled where the paper labels it; for hypothesis-free papers, the relationship the authors set out to examine). A test is one empirical examination of that prediction in one study, described on nine design dimensions (data source, sample and level, period and context, measure of X, measure of Y, estimator and variance, controls and fixed effects, functional form and timing, identification), with its result (direction, support, statistic). Different measures of the same construct are design options, not different predictions; a moderation or mediation of X → Y is a different prediction from the main effect.

A prediction is **core** when it recurs across studies and later work builds on it (the person decides; the import shows recurrence counts and `builds_on` citations). A design decision **matters** when studies that made it differently reached different results; step 6 ranks these, mixed results first.

## 2. Where the human is in the loop

| Step | AI proposes | Person decides |
|---|---|---|
| 0 Inquiry | — | states the question, search terms, seed studies, priors |
| 1 Corpus | candidate studies, citation counts | field boundary, core set; may loop back here from 3–5 |
| 2 Studies | paper type; predictions; the design and result of each test; choices, with quotes; which predictions are the same as existing ones | — (review in step 3) |
| 3 Predictions | merge proposals | confirm / edit / merge / reject; mark core |
| 4 Design map | — | confirm / edit / reject each test |
| 5 Assumptions & decision | hidden assumptions behind the designs, sensitivity, what would relax each, gaps, overlaps | judges each assumption (reasonable / questionable / violated), adds own, decides multiverse vs new study vs both vs stop, with reason |
| 6 Choice space | alignment of AI-found choices with a reference | override matches; final benchmark coding |
| 7 Epistemic map & teams | enumerates specifications; seeded allocation to teams; specification curve | assumption space (dimensions, options, alternatives); allocation mode; which results to keep |
| 8 Reproduce, replicate, export | ranking of design decisions that vary | hand-off to Replication Navigator with the decision; exports |

Every proposal carries `status: "ai"` until a person confirms it. Confirmed and rejected items are kept, so the agreement between AI proposals and human decisions can be computed from the exported JSON (acceptance rate per dimension, per study).

## 3. Grounding and verification

- The extraction prompts require a verbatim quote (8–30 words) and page number for every claim, assumption, choice and tag. Reviewers check items against the PDF.
- The five dimensions and their typical assumptions are grounded in evidence cards from the Replication Navigator evidence base (`knowledge/dimensions.json` maps each dimension to card stages and sources). The grounding block is sent as a cached system prompt, and card ids cited by the model are validated on the server (`/api/explain`).
- The model never sees the reference list when extracting choices (step 2); the comparison (step 5) is a separate call, so the benchmark is not contaminated.

## 4. Benchmarks

- **D1, coverage map of one field.** Validation: two human coders decompose a sample of claims independently; report agreement on dimension and consequentiality; report the AI acceptance rate.
- **D2, analysis-choice benchmark.** Reference: the 19 choices paraphrased from Berchicci & King (2022, §3.1). Procedure: extract the six SMJ papers with step 2, load the reference in step 5, align, then a person checks every match. Result: found / missed / added, per category.
- **D3, forecasting benchmark** (Delios et al., 2022): planned; needs the published forecast data.

## 5. Known limits

- Decomposition is a judgment: the same claim can be decomposed at different grains. The coding scheme (to be written) fixes the grain: one assumption = one thing a future study could vary.
- Long papers can exceed the output budget (the UI warns when the model stopped at `max_tokens`).
- OpenAlex coverage of management journals is good for metadata but abstracts are sometimes missing; local citation counts need OpenAlex ids (exports from Web of Science or Scopus do not carry reference lists in the formats we parse).
- PDFs are not stored; a PDF is kept in browser memory only for the current tab so it can be reused for tagging.
