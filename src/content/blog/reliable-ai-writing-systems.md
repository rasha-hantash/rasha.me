---
title: "Reliable AI Writing Systems"
pubDate: 2026-02-20
description: "A research proposal for detecting and reducing hallucinations in long-form AI writing — problem decomposition, evaluation rubric, proposed architecture, and validation plan."
tags: ["ai", "hallucinations", "system-design", "evaluation"]
draft: false
---

## 1. Problem Decomposition

**Types of Hallucinations in Long-Form AI Writing**

Hallucinations in 5–20 page documents aren't a single failure — they're a cluster of distinct failures with different detection profiles and different costs. In a sources-first system (where every factual claim must cite a provided input), "hallucination" becomes specific and measurable.

**A1 — Missing grounding (uncited factual claims).** The model makes a factual assertion with no citation attached. Detectable structurally: no citation token means automatic flag.

> *"Company X's churn fell 18% in Q3."* — no source attached.

**A2 — Incorrect grounding (citation doesn't support the claim).** The model cites something, but the source doesn't back the claim — wrong section, unrelated passage, or direct contradiction. Sometimes called "citation laundering": it mimics verification without providing it.

> *"Churn fell 18% (Source: Report.pdf p.12)"* — but p.12 says nothing about churn.

**A3 — Intra-document inconsistency (self-contradiction).** The document contradicts itself across sections. Detecting this requires cross-section state tracking, not local claim checking.

> Section 2 defines "active user" as logged in within 30 days. Section 6 treats "active user" as paid subscriber.

---

**Which Matter Most and Why**

**Rank 1 — A2.** A false citation is strictly worse than no citation. It signals verification when there is none, and users who see a citation rarely check. One high-profile A2 failure can invalidate trust in the entire product.

**Rank 2 — A1.** Scales with document length but is structurally detectable (no citation = automatic flag) and often repairable. Lower damage than A2 because it doesn't create false confidence.

**Rank 3 — A3.** Damages credibility but is hardest to detect — requires structured claim representation across the full document. Deferred to v3 not because it's unimportant, but because it needs infrastructure that doesn't exist in v1.

---

### How the Problem Changes With Context

**Document length** is the primary scaling pressure. Early errors propagate: a wrong figure in Section 2 gets restated in Section 5 and summarized incorrectly in Section 8. As output grows, source passages lose salience in the model's context and gap-filling from parametric memory increases — the main driver of A1 and A2 in long-form specifically.

**Domain** shapes which failure is most costly. In medical, legal, and financial contexts, wrong citations are expensive — documents are generated at scale, reviewed quickly, and a confident-sounding fabrication is easy to miss under time pressure.

**Use case** determines what to watch for:
- *Summarization*: hallucination by addition — new facts not in the source.
- *Synthesis across sources*: conflict-averaging — silently resolving source disagreements into confident synthesis instead of preserving them.
- *Analysis*: claim strength exceeding evidence strength — confident assertions where hedged language ("suggests," "may indicate") is warranted.

---

### Root Causes

**Context dilution.** As document length grows, source documents lose salience and the model falls back on parametric memory ([Lost in the Middle, Liu et al., 2023](https://arxiv.org/abs/2307.03172)). Sources that informed Section 2 may be invisible by Section 8. The same dilution applies to instructions — "only use provided sources" loses effective weight over long outputs. Primary driver of A1 and A2.

**No persistent claim state.** The model generates token-by-token with no explicit memory of prior assertions unless the system provides it externally. Direct cause of A3.

**Fluency pressure.** The model is trained to produce coherent text. When evidence is sparse, it interpolates — generating plausible claims to bridge gaps — because the training objective actively optimizes against gaps being *visible*.

**Contradictory source material.** When sources conflict, the model's default is to blend them into confident synthesis rather than surface the conflict. Solvable at the system level (detect conflicts pre-generation, surface to user) but left unaddressed it produces A3 failures disguised as confident conclusions.

---

## 2. Evaluation Rubric

### Defining a Hallucination

A hallucination is any factual claim that fails either of two tests:

**Test 1 — Coverage:** Does the claim have a citation? If not, it's a hallucination by definition. Deterministic — no model judgment needed.

**Test 2 — Support:** Does the cited source actually back the claim? A citation that exists but is irrelevant or contradictory is still a hallucination — and the more dangerous kind, because it looks verified.

Support is measured on a four-class schema:
- **Entails** — the cited passage directly and sufficiently supports the claim as stated.
- **Partially supports** — directionally consistent but incomplete — e.g., a number from a different time period, or a source backing part of a compound claim.
- **Contradicts** — the source says the opposite or the claim materially misrepresents it.
- **Irrelevant** — the citation has no meaningful bearing on the claim.

---

### The Key Trade-off: Precision vs. Recall

A missed hallucination is worse than a false flag. A user who finds one wrong citation loses trust in the whole document; a false flag is annoying but recoverable. So recall is optimized first, with precision as a floor to avoid detector fatigue.

Specific targets aren't set yet — the base hallucination rate isn't known until a first annotation pass. Phase 1 of validation exists to establish that baseline. Everything else is set relative to it.

---

### The Ground Truth Problem

Annotation is harder than it sounds. The annotator must read the claim, read the cited passage, and judge support — genuinely ambiguous at the edges and requiring domain knowledge.

**Agreement gate:** Before using any labeled data as ground truth, two annotators independently label the same sample and measure Cohen's Kappa. The bar is κ ≥ 0.75 before any system metrics are computed. Re-checked whenever guidelines change or a new annotator joins.

**Scale:** A 20-page document can have hundreds of claims; exhaustive annotation is expensive. The approach is two-tier: a small, carefully human-labeled set as the primary standard, and a larger LLM-as-judge set for broader coverage and regression detection — validated against the human set periodically, not treated as ground truth on its own.

**Domain splits:** The benchmark must be split by domain (research reports, technical docs, analytical summaries). A system that looks fine overall can quietly fail on one domain.

---

### Measurement Pipeline (Offline)

1. **Citation linking** — each claim paired with its cited source passage.
2. **Support checking** — LLM judge classifies each pair against the four-class schema. Catches A2.
3. **Coverage checking** — deterministic flag for uncited claims. Catches A1.
4. **Scoring** — system flags compared against human labels → precision, recall, F1.

Triggered whenever the model, prompts, or retrieval logic changes.

---

### Success Criteria

**Phase 1 — Baseline:** Measure hallucination rate per claim, per document, and per domain on a real sample.

**Phase 2 — Targets:** Set thresholds relative to baseline. The specific numbers come from the data, not from guessing upfront.

**Regression:** A meaningful drop in F1 after any model/prompt/retrieval change. "Meaningful" gets defined once variance is known from Phase 1.

**Ongoing:** Re-validate LLM judge alignment with human labels quarterly and after major model changes.

"Solved" doesn't mean zero hallucinations. It means the system catches the failures that matter most, at thresholds grounded in real data, with infrastructure to notice when things get worse.

---

## 3. Proposed Architecture

### Overview

The system has seven stages. Stages 1–5 run in the live path; Stages 6–7 are deferred or offline.

**Stage 1 — Source Indexing.** Source materials are chunked, embedded, and indexed into a per-session vector store. I assume this is done well; the rest of the architecture builds on that assumption.

**Stage 2 — Skeleton Generation.** The first LLM call produces a structured intermediate: claims organized by section, each with the chunk ID of its supporting evidence. This is the factual skeleton — what will be asserted, where, and why — before any prose. Cheap to generate, easy to inspect, and gives downstream stages clean structured inputs rather than requiring claim extraction from prose.

**Stage 3 — Deterministic Coverage Check.** Every claim checked for citation presence. No model call needed. Claims with no citation are dropped. Catches all A1 failures at zero cost.

**Stage 4 — Support Checking (v2).** For every cited claim, an LLM validates the (claim, evidence) pair against the four-class schema defined in the rubric. All checks run in parallel. Claims that "entail" pass through; "partially supports" claims get confidence language downgraded ("demonstrates" → "suggests"); "contradicts" or "irrelevant" claims are dropped. No repair loop — each claim is checked and handled once.

**Stage 5 — Prose Rendering.** The verified skeleton is rendered into long-form text. The prompt constrains strictly: expand claims into fluent prose, introduce no new factual assertions, preserve citation tags, respect confidence language from Stage 4.

**Stage 6 — Intra-Document Consistency Check (v3).** Operates on the full verified skeleton to detect A3 failures. Builds a structured representation of key terms across sections, flagging definitional drift and cross-section contradictions. Deferred because it requires whole-document reasoning, justified only once foundation stages are proven.

**Stage 7 — Offline LLM Judge and Regression Detection.** Runs the LLM judge against sampled production outputs using the same four-class schema. Separate from the live pipeline.

---

### The Core Bet — and Its Risk

The architecture assumes that constraining generation to a verified skeleton meaningfully reduces hallucination in the final prose pass. That's reasonable but unproven. If the prose stage introduces new factual claims at a high rate despite constraints, the skeleton approach moves the problem downstream rather than solving it. Week 2 validation tests this assumption before committing to the full architecture.

---

### Alternatives Considered and Rejected

**Text-first generation with post-hoc claim extraction.** If the full document is generated first, claims must be extracted from prose by an LLM — which can miss claims, misclassify opinions as facts, and introduce errors before verification even starts. The skeleton approach eliminates this extraction step entirely.

**Fine-tuning for citation discipline.** The most durable long-term fix, but requires a high-quality labeled dataset that doesn't exist yet, doesn't guarantee adherence under novel domains, and slows iteration. Becomes the right investment once the system has accumulated enough labeled (claim, evidence, verdict) tuples — probably v3.

---

### Key Trade-offs

*Optimizing for:* ensuring every claim has a citation that actually supports it.

*Sacrificing:* latency and cost. The live pipeline has three sequential LLM calls (skeleton → support check → prose), and total wait time is uncertain per document. Acceptable because users are waiting for a verified document, not a fast stream of consciousness.

*Model selection:* Skeleton generation is structured and constrained — doesn't need a frontier model. Prose rendering does, because writing quality and professional register matter. Which models clear the bar is empirical.

*Cost drivers:* LLM judge and prose rendering. The judge scales with claim volume; prose rendering scales with output length. Primary levers: model selection per stage, batching judge calls, and scoping support checking narrowly.

---

## 4. Validation Plan

### Week 1: Deterministic Coverage Checking

Stages 1–3 and 5 ship: source indexing, skeleton generation, coverage checking, and prose rendering. Every claim is checked for citation presence; uncited claims are dropped before the user sees them. Citation *support* is not yet verified in the live path.

By end of week 1: drop counts are logged per document and baseline skeleton quality data is flowing in.

**Failure scenarios:** A high drop rate means users receive materially incomplete documents — skeleton generation needs fixing before v2. A near-zero drop rate is equally suspicious — citations may be attached indiscriminately, which surfaces as A2 in v2.

### Week 2: Validate the LLM Judge

Pull 30–50 real outputs across document types as the annotation set. Two annotators label independently; if κ < 0.75, the schema is too ambiguous and Stage 4 can't ship against an untrustworthy benchmark. The judge returning "entails" on pairs humans label "contradicts" is a hard stop.

---

### Iteration Plan

**v1 (Weeks 1–4):** Stages 1–3, 5, 7 — skeleton + coverage checking + prose + offline eval.

**v2 (Weeks 4–10):** Stage 4 — live support checking.

**v3 (Weeks 10+):** Stage 6 — intra-document consistency + fine-tuning.

---

### Open Questions

**Skeleton-to-prose leakage.** The residual hallucination surface where prose elaborates beyond the skeleton hasn't been sized. This is the biggest technical risk (see Core Bet above).

**Claim volume distribution.** Cost and latency estimates depend on how many verifiable claims a typical document contains. The 300-claim figure is a working assumption, not a measured baseline. Week 1 establishes this.

**Priority ordering.** The roadmap assumes A1 and A2 are the failures users care most about. Week 1 user flagging data could reveal that incoherence across sections (A3) is the real pain point — in which case A3 detection moves up and the v2/v3 sequencing changes. The phasing is a prior, not a commitment.

**Compound claim handling.** The four-class schema assumes atomic claims, but generated text frequently bundles multiple assertions into a single sentence with one citation. The judge behavior on partial support within compound claims is undefined — this needs explicit annotation guidelines before v2 ships.Example: "Revenue grew 22% and churn fell 18% (Source A)" — what if Source A only supports the revenue figure?
