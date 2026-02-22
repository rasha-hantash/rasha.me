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

**A1 — Missing grounding (uncited factual claims).** The model makes a factual claim with no citation attached. Detectable structurally: no citation token means the claim is logged and dropped from the output.

> *"Company X's churn fell 18% in Q3."* — no source attached.

**A2 — Incorrect grounding (citation doesn't support the claim).** The model cites something, but the source doesn't back the claim — wrong section, unrelated passage, or direct contradiction. Sometimes called "citation laundering": it mimics verification without providing it.

> *"Churn fell 18% (Source: Report.pdf p.12)"* — but p.12 says nothing about churn.

**A3 — Intra-document inconsistency (self-contradiction).** The document contradicts itself across sections. Detecting this requires cross-section state tracking, not local claim checking.

> Section 2 defines "active user" as logged in within 30 days. Section 6 treats "active user" as paid subscriber.

**Out of scope for this proposal but worth naming:**

**Leaping to conclusions.** The citation does support the claim, but the conclusion drawn from multiple valid claims doesn't follow. Each individual source-claim pair checks out; the error is in the logic connecting them. A real failure mode in analytical summaries, but outside the detection framework proposed here.

> *"Revenue grew 22% (Source A) and headcount doubled (Source B), demonstrating that hiring drove growth."* — both citations are correct, but the causal claim isn't supported by either source.

**Hallucinations of omission.** The model selectively ignores key information from sources, producing a document that's technically accurate but misleading by what it leaves out. Particularly dangerous in synthesis tasks where framing matters as much as individual facts.

---

**Which Matter Most and Why**

**Rank 1 — A2.** A false citation is strictly worse than no citation. It signals verification when there is none, and users who see a citation rarely check. One high-profile A2 failure can invalidate trust in the entire product. A2 is the most dangerous failure but also the hardest to detect, so it ships in v2 — with the offline judge collecting data in v1 as interim mitigation.

**Rank 2 — A1.** Scales with document length but is structurally detectable (no citation = automatic flag) and often repairable. Lower damage than A2 because it doesn't create false confidence.

**Rank 3 — A3.** Damages credibility but is hardest to detect — requires structured claim representation across the full document. Deferred to v3 not because it's unimportant, but because it needs infrastructure that doesn't exist in v1.

---

### How the Problem Changes With Context

**Document length** is the primary scaling pressure. Early errors propagate: a wrong figure in Section 2 gets restated in Section 5 and summarized incorrectly in Section 8. As output grows, source passages lose salience in the model's context and gap-filling from parametric memory increases — the main driver of A1 and A2 in long-form specifically.

**Domain** shapes which failure is most costly. In medical, legal, and financial contexts, wrong citations are expensive — documents are generated at scale, reviewed quickly, and a confident-sounding fabrication is easy to miss under time pressure.

**Use case** determines what to watch for:
- *Summarization*: hallucination by addition — new facts not in the source.
- *Technical documentation*: version drift — citing APIs, parameters, or behaviors from the wrong version of a library or system.
- *Analysis*: claim strength exceeding evidence strength — confident claims where hedged language ("suggests," "may indicate") is warranted.

---

### Root Causes

Hallucination is structural, not a bug to be patched. It persists partly because [current evaluation methods set the wrong incentives](https://openai.com/index/why-language-models-hallucinate/) — most benchmarks measure performance in a way that encourages guessing rather than honesty about uncertainty. These pressures are baked in before the model sees your sources.

In long-form, source-grounded writing, five failure modes layer on top:

**Context dilution.** Models struggle to use information buried in the middle of long input contexts. [Liu et al. (2023)](https://arxiv.org/abs/2307.03172) found that performance is highest when relevant information appears at the beginning or end of the context, and degrades significantly when it's in the middle — even for models explicitly designed for long contexts. This means the order and length of the source material you feed the model matters: important sources placed in the middle of a long context may effectively be ignored. Worth noting: the system generates a structured factual skeleton before writing prose (Section 3), and that skeleton itself can grow long for a 20-page document — the prose rendering step is susceptible to this same problem.

**No persistent claim state.** The model generates token-by-token with no explicit memory of prior claims unless the system provides it externally. Direct cause of A3.

**Fluency pressure.** When evidence is sparse, the model interpolates — generating plausible claims to bridge gaps. Evaluation incentives make this worse: a confident fabrication scores better than admitting "I don't know."

**Source confusion under topical similarity.** When multiple source passages cover related topics, the model selects citations based on topical proximity rather than semantic entailment. A passage about Q2 revenue gets cited for a Q3 revenue claim because both discuss revenue — the model treats "about the same topic" as "supports the claim." This is the primary driver of A2: the citation looks plausible at a glance because the source is topically relevant, but the specific claim is not actually supported. Unlike A1 (which is an omission), A2 requires the model to make a *wrong selection* — and current models are not trained to distinguish "topically related" from "semantically entailing."

**Contradictory source material.** When sources conflict, the model's default is to blend them into confident synthesis rather than surface the conflict. Solvable at the system level (detect conflicts pre-generation, surface to user) but left unaddressed it produces A3 failures disguised as confident conclusions.

---

## 2. Evaluation Rubric

Understanding why hallucinations happen — and which failure modes are structural vs. model-specific — shapes what to measure and how. This section covers: how hallucinations are classified, the precision/recall trade-off for detection, cost constraints, the ground truth annotation strategy, and what the system must achieve to ship.

### Defining a Hallucination

A hallucination is any factual claim that fails either of two tests:

**Test 1 — Coverage:** Does the claim have a citation? If not, it's a hallucination by definition. Deterministic.

**Test 2 — Support:** Does the cited source actually back the claim? A citation that exists but is irrelevant or contradictory is still a hallucination — and the more dangerous kind, because it looks verified.

<span id="evaluation-criteria"></span>Support is measured on the following evaluation criteria:
- **Entails** — the cited passage directly and sufficiently supports the claim as stated.
- **Partially supports** — directionally consistent but incomplete — e.g., a number from a different time period, or a source backing part of a compound claim.
- **Contradicts** — the source says the opposite or the claim materially misrepresents it.
- **Irrelevant** — the citation has no meaningful bearing on the claim.

<span id="partial-support"></span>Claims classified as "partially supports" pass through — the citation is directionally correct. The prose rendering stage uses this label to downgrade assertion language — e.g., "suggests" instead of "determined." The offline pipeline evaluates whether "partial" was too generous.

---

### The Key Trade-off: Precision vs. Recall

With the [evaluation criteria](#evaluation-criteria) established, the next question is how to measure detection quality.

The hallucination detector is a binary classifier: for each claim, it decides "valid" or "hallucination." Four metrics describe how well it does that.

**Accuracy** — how often the system gets it right overall, whether the claim is valid or a hallucination. Not useful here: the LLM is writing from provided sources, so in a functioning pipeline the large majority of claims are properly supported and hallucinations are the minority class. Consider the degenerate baseline — a system that labels every claim as valid without inspecting it would still score 90%+ accuracy while catching zero hallucinations. Class imbalance makes this metric misleading.

**Recall** — of all actual hallucinations, how many did the system catch? This is the most important metric. A missed hallucination (false negative) reaches the user as a wrong citation that looks verified — one is enough to undermine trust in the whole document.

**Precision** — when the system flags a claim as a hallucination, is it actually one? Important as a floor: if too many valid claims get dropped, users receive incomplete documents and lose trust for a different reason — over-filtering. But a false flag is recoverable; a missed hallucination isn't.

**F1** — the harmonic mean of precision and recall. Useful as a single number for CI/CD gates and regression tracking, but it doesn't capture the asymmetry — we weight recall higher.

Recall is optimized first, with precision maintained as a floor. A missed hallucination is worse than a false flag — always.

Specific targets aren't set yet — the base hallucination rate isn't known until a first annotation pass. The validation plan's first phase (Week 1) exists to establish that baseline. Everything else is set relative to it. Scores are computed separately for A1 and A2 — a system that's perfect on easy detection (A1) and useless on hard detection (A2) shouldn't look like it's passing.

**Directional targets (exact thresholds set after Week 1 baseline):**

- **A1 recall should be near-perfect.** Coverage checking is a structural test — any claim without a citation is caught automatically. Anything less than near-perfect recall here points to a design problem in the skeleton, not a threshold problem.
- **A2 recall is the harder and more important problem.** The inline judge must catch the large majority of bad citations. This is where most real-world harm comes from — a false citation that looks verified — so the recall bar is set as high as the inline judge's accuracy allows.
- **Precision has a floor.** Below some threshold, the system drops too many valid claims and users receive incomplete documents.
- **Per-domain variance must be bounded.** If recall is high on research reports but poor on technical docs, the system is not production-ready for technical docs regardless of the aggregate score. The acceptable gap between domains is set empirically.

### Cost as a Trade-off Lever

These metrics define what "good" means. The next constraint is what it costs to measure.

Evaluation cost scales with claim volume — the more verifiable claims a document contains, the more LLM judge calls and the more human annotation time. The offline judge adds a second pass on sampled outputs.

The expensive component is human annotation. The [two-tier strategy](#the-ground-truth-problem) — small human-labeled set as ground truth, larger LLM-labeled set for coverage — is a direct response to this cost constraint. The trade-off: LLM-generated labels are cheaper but less trustworthy, so they are validated against the human set periodically rather than treated as ground truth independently.

The precision floor is also a cost constraint in disguise. Every false flag either silently removes valid content (degrading user experience) or requires human review to reinstate (adding cost). A system with high recall but low precision would catch nearly every hallucination while also flagging many valid claims — producing incomplete documents or overwhelming reviewers.

---

### The Ground Truth Problem

Cost constraints shape the annotation strategy — which determines how trustworthy the ground truth is.

Annotation is harder than it sounds. The annotator must read the claim, read the cited passage, and judge support — genuinely ambiguous at the edges and requiring domain knowledge.

**Agreement threshold:** Before using any labeled data as ground truth, two annotators independently label the same sample and measure Cohen's Kappa (a measure of agreement between two annotators, where 0.75+ indicates substantial agreement). The bar is κ ≥ 0.75 before any system metrics are computed. Re-checked whenever guidelines change or a new annotator joins.

**Scale:** A 20-page document can have hundreds of claims; exhaustive annotation is expensive. The approach is two-tier: a small, carefully human-labeled set as the primary standard, and a larger LLM-as-judge set for broader coverage and regression detection — validated against the human set periodically, not treated as ground truth on its own. The LLM-labeled tier follows the "model proposes, humans verify" pattern: the model generates candidate labels, and humans review a sample rather than labeling from scratch — faster because reviewing is cheaper than creating.

**Domain splits:** The benchmark must be split by use-case (research reports, technical docs, analytical summaries). A system that looks fine overall can quietly fail on one domain.

---

### Success Criteria

With the measurement framework and annotation approach defined, here is what the system must achieve.

The evaluation criteria above form a [functional correctness](#working-notes-evaluation-methodology-concepts) evaluation — measuring whether the system performs its intended function (every claim cited, every citation verified), not proxy metrics like perplexity or BLEU. We split this into:

- **Automatic functional correctness testing**, where the outcome is binary (citation present or not) — the coverage check can verify it deterministically.
- **Reference-based functional correctness testing**, where the outcome is a judgment call (does the citation actually support the claim?) — we compare the system's verdicts against human-labeled ground truth using precision, recall, and F1.

**What success looks like.** Two things must be true for every document the system produces:

1. **Every factual claim has a citation.** The coverage check walks the skeleton and flags any claim without one. Catches A1 failures.

2. **Every citation actually supports the claim it's attached to.** That judgment happens twice: once in real time and once offline (the offline judge, Stage 7). Each needs its own success measure.

**The offline judge.**

The offline judge serves three distinct purposes:

*Use 1 — Calibrating the offline judge against human annotators.* Before the offline judge can evaluate anything, we need to know it agrees with humans. Phase 1 (Weeks 1–2) establishes this:

- *a.* One human annotator labels a sample — at least 100 claims across 10+ documents, split by domain.
- *b.* We run the offline judge on the same sample and compare its verdicts to the human labels. This tells us how often the offline judge catches bad citations (recall) and how often its flags are real problems vs. false alarms (precision).
- *c.* These numbers become the offline judge's baseline. If alignment is off, we iterate on the prompt — adjusting criteria, adding [few-shot examples](#working-notes-evaluation-methodology-concepts) (labeled examples included directly in the prompt to teach the model the task), and re-evaluating using metrics like accuracy, precision, and recall until performance improves.

> Eventually, a second annotator labels the same sample independently and we measure inter-annotator agreement (see [agreement threshold](#the-ground-truth-problem)).

**Example calibration prompt** — classifies a single (claim, citation) pair:

```
You are evaluating whether a cited source passage supports a factual claim.
Classify the relationship as one of:
- Entails — the passage directly and sufficiently supports the claim.
- Partially supports — directionally consistent but incomplete.
- Contradicts — the source says the opposite or materially misrepresents the claim.
- Irrelevant — the citation has no meaningful bearing on the claim.

Always explain your reasoning before giving a classification.

Claim: {claim}
Cited passage: {passage}
```

&nbsp;

*Use 2 — Comparing in-app responses against human-labeled reference data.* Run the full pipeline on the golden dataset — documents with human-labeled ground truth — and compare the system's pass/drop decisions against the human labels. Concretely, the pipeline runs four steps:

- *a.* **Citation linking** — each claim paired with its cited source passage.
- *b.* **Support checking** — the offline judge classifies each pair against the [evaluation criteria](#evaluation-criteria). Catches A2.
- *c.* **Coverage checking** — deterministic flag for uncited claims. Catches A1.
- *d.* **Scoring** — system flags compared against human labels → precision, recall, F1.

This gives us the scores that feed into the CI/CD gate.

**Example evaluation prompt** — compares the system's verdict against a human label:

```
You are evaluating whether a cited source passage supports a factual claim.
Classify the relationship as one of:
- Entails — the passage directly and sufficiently supports the claim.
- Partially supports — directionally consistent but incomplete.
- Contradicts — the source says the opposite or materially misrepresents the claim.
- Irrelevant — the citation has no meaningful bearing on the claim.

Two evaluators classified the relationship between the claim and the passage.

Claim: {claim}
Cited passage: {passage}

- Answer 1: {system_verdict}
- Answer 2: {human_label}

Explain your reasoning, then state which answer is better.
```

&nbsp;

*Use 3 — Judging the quality of in-app LLM responses on their own.* The golden dataset grows slowly — annotators can't label every production output. Reference-free evaluation lets the offline judge monitor ongoing pipeline quality at production volume without requiring human labels for every verdict. Independent of reference data, we evaluate whether each LLM stage in the pipeline is doing its job:

- *a. [Skeleton generation (Stage 2)](#stage-2)* — is the LLM producing claims that are actually grounded in the source chunks it cites?
- *b. [Inline support checking (Stage 4)](#stage-4)* — is the verification LLM labeling claim-citation pairs correctly (entails / partially supports / contradicts / irrelevant)?
- *c. [Prose rendering (Stage 5)](#stage-5)* — did the prose stay faithful to the verified skeleton, or did it introduce new unsupported claims?

When the offline judge's confidence on a verdict is low — measured via [logprobs](#working-notes-evaluation-methodology-concepts) (the probability the model assigned to its chosen label vs. alternatives) — that verdict gets sent to human annotators rather than being trusted as evaluation data. Recalibration means updating the offline judge's prompt and [few-shot examples](#working-notes-evaluation-methodology-concepts) based on where it disagrees with humans.

**The inline judge.**

The inline judge checks the skeleton that was just generated. For each cited claim, it classifies the (claim, citation) pair against the [evaluation criteria](#evaluation-criteria). "Entails" or "partially supports" passes; "contradicts" or "irrelevant" gets dropped.

The inline judge logs a confidence score ([logprobs](#working-notes-evaluation-methodology-concepts)) alongside each verdict. These scores direct the offline pipeline: when sampling production outputs for evaluation, the system prioritizes the verdicts where the inline judge was least confident, checking the weakest calls first rather than sampling randomly.


**CI/CD pipeline.**

The CI/CD pipeline runs the offline reference-based LLM judge on every deployment. A deployment is blocked when the offline judge has high disagreement with the inline judge that generated the verdicts.

**What "solved" means.** Not zero hallucinations. It means: every claim is cited, bad citations are caught reliably, regressions are blocked before they deploy, and all of this holds per domain — not just in aggregate.

### Working Notes: Evaluation Methodology Concepts

*Scratchpad for concepts from Chip Huyen's AI Engineering (Ch. 3) and other sources. Each entry captures a concept and how it connects to or strengthens the existing rubric.*

**Functional correctness** (Huyen, Ch. 3) — Evaluating a system based on whether it performs its intended functionality. Example: if AI schedules workloads to optimize energy consumption, performance is measured by energy saved. Section 2's rubric is an instance of this: the intended function is "every claim cited, every citation verified," and the metrics (precision, recall, F1) measure exactly that outcome. This is worth naming because it distinguishes the approach from proxy-based evaluation (e.g., perplexity, BLEU) — the rubric measures the thing we actually care about.

**Few-shot prompting** (Brown et al., 2020; Huyen, Ch. 5) — Teaching a model to perform a task by including labeled examples in the prompt, also known as in-context learning. Each example provided is called a "shot" — five examples is five-shot, no examples is zero-shot.

**Logprobs** (log probabilities) — When a model classifies a claim as "entails," logprobs tell you how much probability mass it put on that token vs. the alternatives. High probability = high confidence. This is the mechanism behind the "confidence score" referenced in Stage 4 and in the evaluation sections. *Not every model exposes logprobs — must check which models in use support them, and whether an alternative confidence-extraction method is needed for models that don't.*

**AI-generated reference data** (Huyen, Ch. 3) — It's increasingly common to have AI generate reference data (synthetic labels) and then have humans review it, rather than having humans generate reference data from scratch. The pattern inverts the traditional workflow: instead of "human labels, model learns," it's "model proposes, human verifies." This is faster because reviewing is cheaper than creating.

---

## 3. Proposed Architecture

### Overview

The system has seven stages. Stages 1–5 run in the live path; Stages 6–7 are deferred or offline.

**Stage 1 — Source Indexing.** Source materials are chunked, embedded, and indexed into a per-session vector store. The rest of the architecture assumes this step is done correctly.

> **Risk note:** Source indexing is load-bearing for every downstream stage. Chunking strategy matters: chunks too large produce imprecise entailment judgments (the inline judge sees a relevant passage buried in irrelevant context); chunks too small lose the context needed to support a claim. Embedding model selection matters: poor domain representations cause the skeleton to cite wrong evidence, and every downstream stage inherits that error. Retrieval quality is not validated in v1 — if Stage 4 shows a high "irrelevant" rate, retrieval is the first place to investigate.

<span id="stage-2"></span>**Stage 2 — Skeleton Generation.** The first LLM call produces the factual skeleton: claims organized by section, each with the chunk ID of its supporting evidence — what will be asserted, where, and why — before any prose. Cheap to generate, easy to inspect, and gives downstream stages clean structured inputs rather than requiring claim extraction from prose.

**Stage 3 — Deterministic Coverage Check.** Every claim checked for citation presence. No model call needed. Claims with no citation are flagged and dropped from the output. Catches all A1 failures at zero cost.

<span id="stage-4"></span>**Stage 4 — Inline Support Checking (v2).** The first of two LLM-as-judge roles in the system — this one runs in the live path on every claim before the user sees anything. For every cited claim, an LLM classifies the (claim, evidence) pair against the [evaluation criteria](#evaluation-criteria). All checks run in parallel.

- **Binary action:** "entails" or "partially supports" → pass; "contradicts" or "irrelevant" → drop. The label is preserved in the skeleton so Stage 5 can use it to calibrate assertion language.
- **Confidence scores:** each verdict includes a score (derived from logprobs), verdicts with low scores go directly to the offline evaluation pipeline. Not to change inline behavior.
- **No repair loop (yet):** dropped claims are currently discarded. Future iterations (v2 or v3) could attempt repair — finding a better citation or reformulating the claim — rather than silently removing it.

<span id="stage-5"></span>**Stage 5 — Prose Rendering.** The skeleton is rendered into long-form text. In v1, this is the coverage-checked skeleton (no support labels — Stage 4 hasn't shipped yet). In v2, once Stage 4 is live, the two surviving labels [control assertion language](#partial-support) — "entails" gets confident prose, "partially supports" gets downgraded prose. No new factual claims introduced, citation tags preserved.

**Stage 6 — Intra-Document Consistency Check (v3).** Operates on the full verified skeleton to detect A3 failures. Builds a structured representation of key terms across sections, flagging definitional drift and cross-section contradictions. Deferred because it requires whole-document reasoning, justified only once foundation stages are proven.

**Stage 7 — Offline LLM Judge and CI/CD Pipeline.** The second judge role — this one runs offline against sampled production outputs, not in the live path. Uses the same [evaluation criteria](#evaluation-criteria) as Stage 4, but serves a different purpose: measuring system-level accuracy over time rather than making per-claim decisions in real time. This is the offline judge that feeds the CI/CD pipeline and gets calibrated against human labels.

---

### The Core Bet — and Its Risk

The architecture assumes that constraining generation to a verified skeleton meaningfully reduces hallucination in the final prose pass. That's reasonable but unproven. If the prose stage introduces new factual claims at a high rate despite constraints, the skeleton approach moves the problem downstream rather than solving it. The validation plan tests this assumption before committing to the full architecture.

---

### Alternatives Considered

**Annotated prose generation.** Skip the skeleton. Generate full prose directly, but ask the model to tag each claim inline with its source citation as it writes. You get natural document flow *and* structured claim-citation pairs you can extract and verify — without a separate claim-extraction step. Trade-offs: no pre-prose checkpoint (you generate first, verify after — wasting the call if many claims fail), silent gaps (unannotated claims skip verification entirely), and dual-task pressure (the model writes prose and produces structured annotations in the same call). None are dealbreakers — the silent-gaps problem is the same shape as the skeleton's [leakage risk](#open-questions). This is the approach the industry has converged on — it's what [Perplexity AI](https://www.frugaltesting.com/blog/behind-perplexitys-architecture-how-ai-search-handles-real-time-web-data), [Google AI Overviews](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-search), and a [NeurIPS 2025 study on citation paradigms](https://arxiv.org/abs/2509.21557) all use or recommend.

**Chunked prose rendering.** Same verified skeleton, but instead of rendering the full document in one LLM call, render one section at a time. Each call gets a focused input — one section of the skeleton plus its sources — so the model stays grounded and context dilution is less of a concern. The trade-off is more LLM calls (one per section), higher latency, and the model doesn't see the full document while writing each section, so cross-section flow may feel disjointed. If Week 2 shows that rendering the full skeleton at once causes quality problems — elevated leakage rate, degraded prose quality, or both — chunked rendering becomes the fallback.

**Narrative-aware skeleton.** Push coherence upstream into the skeleton itself — make skeleton generation produce a narrative blueprint with claims ordered by rhetorical function and transition hints between sections, rather than leaving narrative flow entirely to the prose renderer. This makes chunked rendering more viable (each section knows where it sits in the arc), but skeleton generation becomes a harder task — the LLM has to consider both factual grounding and rhetorical structure in one call — and narrative quality is harder to verify mechanically than evidence links.

---

### Key Trade-offs

*Optimizing for:* ensuring every claim has a citation that actually supports it.

*Sacrificing:* latency and cost. The live pipeline has three sequential LLM calls (skeleton → support check → prose). Rate limits could push total time to several minutes if inline judge calls must be batched. Week 1 establishes actual numbers. Acceptable because users are waiting for a verified document, not a fast stream of consciousness.

*Model selection — API vs. self-hosted:* Not every stage needs a frontier model. Skeleton generation is structured and constrained; the LLM judge is a classification task. Both are strong candidates for open-source models. Prose rendering is the opposite — writing quality and professional register matter, and frontier models (GPT-4o, Claude Opus, Gemini Ultra) are generally API-only. You can't download and run them yourself. Which models clear the bar at each stage is empirical.

At 10,000 users the API-vs-self-hosted question becomes material. Three factors drive the decision:

- **Rate limits.** API providers cap requests per minute. OpenAI's GPT-4o, for example, allows 500 RPM at Tier 1 and tops out at 10,000 RPM at Tier 5. A multi-stage pipeline multiplies the request volume per user, so these ceilings matter at scale.
- **Latency.** Every API call is a network call. Self-hosted models cut out that round trip, giving you more predictable response times.
- **Cost curve.** API pricing is per-token and scales linearly — 10× the users means 10× the cost. Self-hosted has high fixed costs but lower marginal cost per request, so at enough volume the economics flip.

The fixed costs of self-hosting are real. You need infrastructure engineers to set up and maintain inference servers, optimize the model for your hardware, scale capacity to match demand, and build guardrails that API providers give you out of the box. That's non-trivial time, talent, and ongoing operational burden. But once the infrastructure is running, each additional request costs only compute — no per-token markup, no rate limit negotiation.

The practical answer is often a hybrid: use API models where you need frontier quality (prose rendering) and self-host where a capable open-source model clears the bar (inline judge, skeleton generation). This caps your API costs at the stages that actually need it.

*Cost drivers:* inline judge and prose rendering. The inline judge scales with claim volume; prose rendering scales with output length. Primary levers: model selection per stage, batching inline judge calls, and scoping support checking narrowly.

---

## 4. Validation Plan

### Week 1: Deterministic Coverage Checking

Stages 1–3 and 5 ship: source indexing, skeleton generation, coverage checking, and prose rendering. Stage 5 renders prose from the coverage-checked skeleton — all claims have citations, but those citations have not been classified for support strength yet (Stage 4 ships in v2). Every claim is checked for citation presence; uncited claims are dropped before the user sees them.

By end of week 1: drop counts are logged per document and baseline skeleton quality data is flowing in.

**Failure scenarios:** A high drop rate means users receive materially incomplete documents — skeleton generation needs fixing before v2. A near-zero drop rate is equally suspicious — citations may be attached indiscriminately, which surfaces as A2 in v2.

**Skeleton-to-prose leakage test.** For each document, extract factual claims from the rendered prose and diff them against the verified skeleton. Claims present in the prose but absent from the skeleton are leakage — new claims the prose stage invented. The leakage rate (leaked claims / total prose claims) is the single most important metric from Week 1. The acceptable threshold is set after Week 1 establishes a baseline. If the rate stays unacceptably high, the skeleton approach is not constraining generation enough and the annotated prose generation alternative moves from "serious contender" to primary candidate.

### Week 2: Validate the LLM Judge

Pull real outputs across document types as the annotation set. Two annotators label independently; if inter-annotator agreement falls below [the threshold established in the Ground Truth section](#the-ground-truth-problem), the schema is too ambiguous and Stage 4 can't ship against an untrustworthy benchmark. The offline judge returning "entails" on pairs humans label "contradicts" is a hard stop.

---

### Iteration Plan

**v1 (Weeks 1–4):** Stages 1–3, 5, 7 — skeleton + coverage checking + prose + offline eval. Stage 7 begins uncalibrated; its output during Weeks 1–2 is used to collect data for calibration, not as trusted evaluation.

**v2 (Weeks 4–10):** Stage 4 — live support checking.

**v3 (Weeks 10+):** Stage 6 — intra-document consistency + fine-tuning.

---

### Abandon Criteria

Three outcomes would trigger a pivot away from the skeleton-first architecture:

1. **Prose leakage rate stays unacceptably high after prompt iteration.** The threshold is set after Week 1 establishes a baseline. If the prose stage consistently introduces new factual claims not in the skeleton, the skeleton is not constraining generation — it's just adding latency. Pivot to annotated prose generation with post-hoc verification.

2. **Judge calibration fails to reach adequate inter-annotator agreement after two prompt revision cycles.** If the LLM judge cannot agree with human annotators at even a moderate level, inline support checking (Stage 4) cannot ship. The architecture reduces to coverage checking only, which may not justify the skeleton overhead.

3. **End-to-end latency exceeds user tolerance with no clear path to reduction.** Users will not wait indefinitely for a verified document. If the three-call pipeline is fundamentally too slow, a single-pass approach with post-generation verification becomes necessary despite its drawbacks.

---

### Open Questions

**Skeleton-to-prose leakage.** *Addressed by Week 1.* The prose generated from the skeleton may still hallucinate claims that weren't mapped back to the skeleton. How often this happens hasn't been measured yet. This is the biggest uncertainty in the architecture (see Core Bet above).

**Claim volume distribution.** *Addressed by Week 1.* Cost and latency estimates depend on how many verifiable claims a typical document contains. The current claim count is a working assumption, not a measured baseline. Week 1 establishes this.

**Priority ordering.** *Addressed by Week 1.* The roadmap assumes A1 and A2 are the failures users care most about. Week 1 user flagging data could reveal that incoherence across sections (A3) is the real pain point — in which case A3 detection moves up and the v2/v3 sequencing changes. The phasing is a prior, not a commitment.

**False negatives from citation generation failures.** *Design question for v2.* The system cuts claims that lack citations, but some of those claims are perfectly supportable — the LLM just failed to produce the citation. This conflates two different problems: the claim being wrong and the citation step being incomplete. How aggressively should the system attempt retrieval-based recovery before dropping an uncited claim, and what's the cost/latency tradeoff of a second-pass citation search?

**Compound claim handling.** *Design question for v2 — needs annotation guidelines before ship.* The [evaluation criteria](#evaluation-criteria) assume atomic claims, but generated text frequently bundles multiple claims into a single sentence with one citation. The inline judge's behavior on partial support within compound claims is undefined — this needs explicit annotation guidelines before v2 ships. Example: "Revenue grew 22% and churn fell 18% (Source A)" — what if Source A only supports the revenue figure?

**User feedback as a signal for improvement.** *Deferred beyond v3.* The system generates verification judgments at scale, but users also generate signal — editing flagged claims, restoring dropped claims, reporting errors the system missed. These patterns are a natural source of labeled data for offline judge calibration, retrieval quality monitoring, and annotation prioritization. The feedback loop isn't designed yet: what's captured, how it's stored, and how it flows back into evaluation and retraining are open design questions.

**UX and transparency at 10K users.** *Deferred beyond v3.* The system drops unsupported claims and downgrades language for partially supported ones, but users currently have no visibility into *why*. Open questions: Do users see what was dropped and why? Can they override the system (restore a dropped claim, escalate a flagged citation)? Does transparency improve trust or create noise? At 10K users across different domains and risk tolerances, a single UX may not fit — a legal analyst may want full audit trails while a content writer may want clean output with minimal friction. How the system surfaces its decisions, and how much control users have over verification strictness, shapes adoption as much as detection accuracy does.

---

## Resources

- [How to Align LLM Judge with Human Labels](https://www.evidentlyai.com/blog/how-to-align-llm-judge-with-human-labels#4-evaluate-and-iterate)
