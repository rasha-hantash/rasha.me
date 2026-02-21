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

**Out of scope for this proposal but worth naming:**

**Reasoning hallucinations.** The citation does support the claim, but the conclusion drawn from multiple valid claims doesn't follow. Each individual source-claim pair checks out; the error is in the logic connecting them. A real failure mode in analytical summaries, but outside the detection framework proposed here.

> *"Revenue grew 22% (Source A) and headcount doubled (Source B), demonstrating that hiring drove growth."* — both citations are correct, but the causal claim isn't supported by either source.

**Hallucinations of omission.** The model selectively ignores key information from sources, producing a document that's technically accurate but misleading by what it leaves out. Particularly dangerous in synthesis tasks where framing matters as much as individual facts.

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
- *Technical documentation*: version drift — citing APIs, parameters, or behaviors from the wrong version of a library or system.
- *Analysis*: claim strength exceeding evidence strength — confident assertions where hedged language ("suggests," "may indicate") is warranted.

---

### Root Causes

Hallucination is structural, not a bug to be patched. It persists partly because [current evaluation methods set the wrong incentives](https://openai.com/index/why-language-models-hallucinate/) — most benchmarks measure performance in a way that encourages guessing rather than honesty about uncertainty. These pressures are baked in before the model sees your sources.

In long-form, source-grounded writing, four failure modes layer on top:

**Context dilution.** Models struggle to use information buried in the middle of long input contexts. [Liu et al. (2023)](https://arxiv.org/abs/2307.03172) found that performance is highest when relevant information appears at the beginning or end of the context, and degrades significantly when it's in the middle — even for models explicitly designed for long contexts. This means the order and length of the source material you feed the model matters: important sources placed in the middle of a long context may effectively be ignored. Worth noting: the skeleton itself can grow long for a 20-page document — the prose rendering step is susceptible to this same problem.

**No persistent claim state.** The model generates token-by-token with no explicit memory of prior assertions unless the system provides it externally. Direct cause of A3.

**Fluency pressure.** When evidence is sparse, the model interpolates — generating plausible claims to bridge gaps. Evaluation incentives make this worse: a confident fabrication scores better than admitting "I don't know."

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

<span id="partial-support"></span>Claims classified as "partially supports" pass through — the citation is directionally correct. Stage 5 (prose rendering) uses this label to downgrade assertion language — e.g., "suggests" instead of "determined." The offline pipeline evaluates whether "partial" was too generous.

---

### The Key Trade-off: Precision vs. Recall

The hallucination detector is a binary classifier: for each claim, it decides "valid" or "hallucination." Four metrics describe how well it does that.

**Accuracy** — how often the system gets it right overall, whether the claim is valid or a hallucination. Not useful here: the LLM is writing from provided sources, so in a functioning pipeline the large majority of claims are properly supported and hallucinations are the minority class. Consider the degenerate baseline — a system that labels every claim as valid without inspecting it would still score 90%+ accuracy while catching zero hallucinations. Class imbalance makes this metric misleading.

**Recall** — of all actual hallucinations, how many did the system catch? This is the most important metric. A missed hallucination (false negative) reaches the user as a wrong citation that looks verified — one is enough to undermine trust in the whole document.

**Precision** — when the system flags a claim as a hallucination, is it actually one? Important as a floor: if too many valid claims get dropped, users receive incomplete documents and lose trust for a different reason — over-filtering. But a false flag is recoverable; a missed hallucination isn't.

**F1** — the harmonic mean of precision and recall. Useful as a single number for CI/CD gates and regression tracking, but it doesn't capture the asymmetry — we weight recall higher.

Recall is optimized first, with precision maintained as a floor. A missed hallucination is worse than a false flag — always.

Specific targets aren't set yet — the base hallucination rate isn't known until a first annotation pass. Phase 1 of validation exists to establish that baseline. Everything else is set relative to it. Scores are computed separately for A1 and A2 — a system that's perfect on easy detection (A1) and useless on hard detection (A2) shouldn't look like it's passing.

---

### The Ground Truth Problem

Annotation is harder than it sounds. The annotator must read the claim, read the cited passage, and judge support — genuinely ambiguous at the edges and requiring domain knowledge.

**Agreement threshold:** Before using any labeled data as ground truth, two annotators independently label the same sample and measure Cohen's Kappa. The bar is κ ≥ 0.75 before any system metrics are computed. Re-checked whenever guidelines change or a new annotator joins.

**Scale:** A 20-page document can have hundreds of claims; exhaustive annotation is expensive. The approach is two-tier: a small, carefully human-labeled set as the primary standard, and a larger LLM-as-judge set for broader coverage and regression detection — validated against the human set periodically, not treated as ground truth on its own.

**Domain splits:** The benchmark must be split by use-case (research reports, technical docs, analytical summaries). A system that looks fine overall can quietly fail on one domain.

---

### Measurement Pipeline (Offline)

1. **Citation linking** — each claim paired with its cited source passage.
2. **Support checking** — LLM judge classifies each pair against the four-class schema. Catches A2.
3. **Coverage checking** — deterministic flag for uncited claims. Catches A1.
4. **Scoring** — system flags compared against human labels → precision, recall, F1.

Triggered whenever the model, prompts, or retrieval logic changes.

---

### Success Criteria

**What success looks like.** Two things must be true for every document the system produces:

1. Every factual claim has a citation. No unsourced assertions.
2. Every citation actually supports the claim it's attached to. No fake or irrelevant references.

The first is easy to check — deterministic unit tests can verify that every claim has a citation attached, no model judgment needed. The second requires an LLM to read the claim, read the cited source, and decide whether they match. That judgment happens twice in the system: once in real time (the inline judge, Stage 4) and once offline (the offline judge, Stage 7). Each needs its own success measure.

**Measuring the offline judge: alignment with human annotators.**

Before trusting any automated metric, we need to know the offline judge agrees with humans. Phase 1 (Weeks 1–2) establishes this:

- Two human annotators independently label the same sample — at least 100 claims across 10+ documents, split by domain.
- We measure how often the annotators agree with each other using Cohen's Kappa (κ). If the humans can't agree (κ < 0.75), the labeling guidelines are too ambiguous and nothing downstream can be trusted.
- Once humans agree, we run the offline judge on the same sample and compare its labels to the human labels. This tells us: how often does the judge catch bad citations (recall), and how often are its flags real problems vs. false alarms (precision).
- These numbers become the baseline. Every future change to the system is measured against them.

When the offline judge's own confidence on a verdict is low, that verdict gets sent to human annotators for verification rather than being trusted as evaluation data. The offline judge is recalibrated against fresh human labels quarterly and after any major model swap. If judge-human agreement drops, we fix the judge before trusting any system metrics.

**Measuring the inline judge: accuracy in production.**

The inline judge (Stage 4) runs on every claim in real time. We can't have humans review every production document, so we measure it indirectly:

- Sample production outputs regularly and run them through the offline evaluation pipeline — the same human-calibrated process described above.
- Compare what the inline judge decided (pass or drop) against what the offline pipeline says should have happened.
- Track the disagreement rate. If the inline judge is passing claims that the offline pipeline flags as unsupported, that's the gap to close.

The inline judge logs a confidence score alongside each verdict. These scores don't change the inline judge's behavior — it makes a hard call and moves on. Instead, they direct the offline pipeline: when sampling production outputs for evaluation, the system prioritizes the verdicts where the inline judge was least confident, checking the weakest calls first rather than sampling randomly.


**CI/CD pipeline.**

Any change to the model, prompts, or retrieval logic runs the full eval suite before deploy. If scores drop, the change is blocked — same pattern as a failing test suite. The gate runs per-domain: a change that improves research reports but makes legal docs worse doesn't pass.

When scores drop, there are three possible causes:
- *The system actually got worse.* Real regression — block the deploy.
- *The offline judge drifted.* The measurement changed, not the system. Recalibrate the judge before trusting any metrics.
- *The human labels were noisy.* The benchmark itself is unreliable. Bounded by the κ gate from Phase 1, but never fully eliminated.

How to tell which: check judge-human agreement separately from system scores. If the judge still agrees with humans but system scores dropped, the system really regressed — block the deploy. If judge-human agreement itself dropped, the judge drifted — fix that first.

**What "solved" means.** Not zero hallucinations. It means: every claim is cited, bad citations are caught reliably, regressions are blocked before they deploy, and all of this holds per domain — not just in aggregate.

---

## 3. Proposed Architecture

### Overview

The system has seven stages. Stages 1–5 run in the live path; Stages 6–7 are deferred or offline.

**Stage 1 — Source Indexing.** Source materials are chunked, embedded, and indexed into a per-session vector store. The rest of the architecture treats this as a dependency, not a given — poor chunking or retrieval directly increases A2 failures downstream (the model cites the best available chunk, which may not actually support the claim if the right chunk wasn't retrieved). Indexing quality is monitored via Stage 7: if A2 rates spike in a specific domain, retrieval is the first suspect.

**Stage 2 — Skeleton Generation.** The first LLM call produces a structured intermediate: claims organized by section, each with the chunk ID of its supporting evidence. This is the factual skeleton — what will be asserted, where, and why — before any prose. Cheap to generate, easy to inspect, and gives downstream stages clean structured inputs rather than requiring claim extraction from prose.

**Stage 3 — Deterministic Coverage Check.** Every claim checked for citation presence. No model call needed. Claims with no citation are dropped. Catches all A1 failures at zero cost.

**Stage 4 — Inline Support Checking (v2).** The first of two LLM-as-judge roles in the system — this one runs in the live path on every claim before the user sees anything. For every cited claim, an LLM validates the (claim, evidence) pair against the four-class schema defined in the rubric. All checks run in parallel.

- **Binary action:** "entails" or "partially supports" → pass; "contradicts" or "irrelevant" → drop. The four-class label is preserved in the skeleton so Stage 5 can use it to calibrate assertion language.
- **Confidence scores:** each verdict includes a score (derived from logprobs), used to [direct the offline evaluation pipeline](#success-criteria) — not to change inline behavior.
- **No repair loop (yet):** dropped claims are currently discarded. Future iterations could attempt repair — finding a better citation or reformulating the claim — rather than silently removing it.

**Stage 5 — Prose Rendering.** The verified skeleton is rendered into long-form text. The two surviving labels [control assertion language](#partial-support) — "entails" gets confident prose, "partially supports" gets downgraded prose. No new factual assertions introduced, citation tags preserved.

**Stage 6 — Intra-Document Consistency Check (v3).** Operates on the full verified skeleton to detect A3 failures. Builds a structured representation of key terms across sections, flagging definitional drift and cross-section contradictions. Deferred because it requires whole-document reasoning, justified only once foundation stages are proven.

**Stage 7 — Offline LLM Judge and CI/CD Pipeline.** The second judge role — this one runs offline against sampled production outputs, not in the live path. Uses the same four-class schema as Stage 4, but serves a different purpose: measuring system-level accuracy over time rather than making per-claim decisions in real time. This is the judge that feeds the CI/CD pipeline and gets calibrated against human labels.

---

### The Core Bet — and Its Risk

The architecture assumes that constraining generation to a verified skeleton meaningfully reduces hallucination in the final prose pass. That's reasonable but unproven. If the prose stage introduces new factual claims at a high rate despite constraints, the skeleton approach moves the problem downstream rather than solving it. Week 2 validation tests this assumption before committing to the full architecture.

---

### Alternatives Considered

**Annotated prose generation.** Skip the skeleton. Generate full prose directly, but ask the model to tag each claim inline with its source citation as it writes. You get natural document flow *and* structured claim-citation pairs you can extract and verify — without needing a separate claim-extraction step. Three trade-offs worth noting:

- **No pre-prose checkpoint.** The skeleton lets you inspect the factual plan before spending tokens on prose. Here, you generate first, verify after. If many claims fail verification, the generation call was wasted.
- **Silent gaps.** The model might make a claim and not annotate it. Unannotated claims skip verification entirely. A "find missing annotations" pass helps, but that's partly the claim-extraction problem again.
- **Dual-task pressure.** The model writes prose and produces structured annotations in the same call. Splitting those into separate steps (the skeleton approach) may let each step be done better.

None of these are dealbreakers — the silent-gaps problem is the same shape as the skeleton's [leakage risk](#open-questions). This is a serious contender worth testing alongside the skeleton approach.

**Chunked prose rendering.** Same verified skeleton, but instead of rendering the full document in one LLM call, render one section at a time. Each call gets a focused input — one section of the skeleton plus its sources — so the model stays grounded and context dilution is less of a concern. The trade-off is more LLM calls (one per section), higher latency, and the model doesn't see the full document while writing each section, so cross-section flow may feel disjointed. If Week 2 shows that rendering the full skeleton at once causes quality problems, chunked rendering becomes the fallback.

**Narrative-aware skeleton.** Push coherence upstream into the skeleton itself. Right now the skeleton is a factual structure — claims organized by section with evidence links — and the prose renderer is responsible for narrative flow. The alternative: make skeleton generation explicitly produce a narrative blueprint, with claims ordered by rhetorical function (setup → evidence → synthesis → implication) and lightweight transition hints between sections. This makes chunked rendering more viable, since each section already knows where it sits in the narrative arc and doesn't need full-document context to sound coherent. The trade-off is that skeleton generation becomes a harder task — the LLM has to consider both factual grounding and rhetorical structure in one call — and narrative quality is harder to verify mechanically than evidence links.

---

### Key Trade-offs

*Optimizing for:* ensuring every claim has a citation that actually supports it.

*Sacrificing:* latency and cost. The live pipeline has three sequential LLM calls (skeleton → support check → prose), and total wait time is uncertain per document. Acceptable because users are waiting for a verified document, not a fast stream of consciousness.

*Model selection — API vs. self-hosted:* Not every stage needs a frontier model. Skeleton generation is structured and constrained; the LLM judge is a classification task. Both are strong candidates for open-source models. Prose rendering is the opposite — writing quality and professional register matter, and frontier models (GPT-4o, Claude Opus, Gemini Ultra) are generally API-only. You can't download and run them yourself. Which models clear the bar at each stage is empirical.

At 10,000 users the API-vs-self-hosted question becomes material. Three factors drive the decision:

- **Rate limits.** API providers cap requests per minute. OpenAI's GPT-4o, for example, allows 500 RPM at Tier 1 and tops out at 10,000 RPM at Tier 5. A multi-stage pipeline multiplies the request volume per user, so these ceilings matter at scale.
- **Latency.** Every API call is a network call. Self-hosted models cut out that round trip, giving you more predictable response times.
- **Cost curve.** API pricing is per-token and scales linearly — 10× the users means 10× the cost. Self-hosted has high fixed costs but lower marginal cost per request, so at enough volume the economics flip.

The fixed costs of self-hosting are real. You need infrastructure engineers to set up and maintain inference servers, optimize the model for your hardware, scale capacity to match demand, and build guardrails that API providers give you out of the box. That's non-trivial time, talent, and ongoing operational burden. But once the infrastructure is running, each additional request costs only compute — no per-token markup, no rate limit negotiation.

The practical answer is often a hybrid: use API models where you need frontier quality (prose rendering) and self-host where a capable open-source model clears the bar (judge, skeleton generation). This caps your API costs at the stages that actually need it.

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

**Skeleton-to-prose leakage.** The prose generated from the skeleton may still hallucinate claims that weren't mapped back to the skeleton. How often this happens hasn't been measured yet. This is the biggest uncertainty in the architecture (see Core Bet above).

**Claim volume distribution.** Cost and latency estimates depend on how many verifiable claims a typical document contains. The 300-claim figure is a working assumption, not a measured baseline. Week 1 establishes this.

**Priority ordering.** The roadmap assumes A1 and A2 are the failures users care most about. Week 1 user flagging data could reveal that incoherence across sections (A3) is the real pain point — in which case A3 detection moves up and the v2/v3 sequencing changes. The phasing is a prior, not a commitment.

**False negatives from citation generation failures.** The system cuts claims that lack citations, but some of those claims are perfectly supportable — the LLM just failed to produce the citation. This conflates two different problems: the claim being wrong and the citation step being incomplete. How aggressively should the system attempt retrieval-based recovery before dropping an uncited claim, and what's the cost/latency tradeoff of a second-pass citation search?

**Compound claim handling.** The four-class schema assumes atomic claims, but generated text frequently bundles multiple assertions into a single sentence with one citation. The judge behavior on partial support within compound claims is undefined — this needs explicit annotation guidelines before v2 ships. Example: "Revenue grew 22% and churn fell 18% (Source A)" — what if Source A only supports the revenue figure?

**User feedback as a signal for improvement.** The system generates verification judgments at scale, but users also generate signal — editing flagged claims, restoring dropped claims, reporting errors the system missed. These patterns are a natural source of labeled data for judge calibration, retrieval quality monitoring, and annotation prioritization. The feedback loop isn't designed yet: what's captured, how it's stored, and how it flows back into evaluation and retraining are open design questions.

**UX and transparency at 10K users.** The system drops unsupported claims and downgrades language for partially supported ones, but users currently have no visibility into *why*. Open questions: Do users see what was dropped and why? Can they override the system (restore a dropped claim, escalate a flagged citation)? Does transparency improve trust or create noise? At 10K users across different domains and risk tolerances, a single UX may not fit — a legal analyst may want full audit trails while a content writer may want clean output with minimal friction. How the system surfaces its decisions, and how much control users have over verification strictness, shapes adoption as much as detection accuracy does.
