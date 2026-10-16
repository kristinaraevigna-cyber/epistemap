# Method notes (v0.1)

These notes record the design decisions behind Coverage Map so they can go into the technical appendix of the Organization Science proposal.

## 1. Unit of analysis

The unit is the **claim–assumption pair**, not the paper. A claim is one empirical relationship a study reports ("corporate social performance is positively associated with financial performance"). Its assumptions are the conditions under which the reported result carries its interpretation, sorted into five dimensions (theory, constructs, design and sample, analysis, context). A study *covers* an assumption when it deliberately varied, tested or relaxed it relative to the original.

Diagnostic coverage of a claim = (number of confirmed assumptions varied by at least one study) / (number of confirmed assumptions), reported unweighted and weighted by consequentiality (1–3).

## 2. Where the human is in the loop

| Step | AI proposes | Person decides |
|---|---|---|
| 1 Corpus | candidate studies, citation counts | field boundary, core set |
| 2 Studies | claims, assumptions, choices with quotes | — (review in step 3) |
| 3 Claims | — | confirm / edit / reject each item; consequentiality |
| 4 Coverage | which assumptions a study varied, with quotes | confirm / reject each tag |
| 5 Choice space | alignment of AI-found choices with a reference | override matches; final benchmark coding |
| 6 Export | ranking of untested assumptions | what to test next |

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
