---
title: "From LBJ to FHIR: What J-codes taught me about US healthcare coding"
pubDate: 2026-05-11
description: "A builder's tour of why infusion claims get denied, what the two-tier HCPCS system actually is, and why the 2026 FHIR mandate carved out the exact use case I was building for."
tags: ["healthcare", "fhir", "x12", "hcpcs", "interoperability"]
draft: false
---

_A builder's tour of why infusion claims get denied, what the two-tier HCPCS system actually is, and why the 2026 FHIR mandate carved out the exact use case I was building for._

---

I spent a stretch of my last build cycle on a unified referral inbox for infusion clinics. The pitch was simple: intake forms come in from a dozen referring offices in a dozen formats — fax, PDF, EHR portal export, the occasional Word doc — and the clinic's intake coordinator burns hours retyping the same thirty fields into their billing and EHR systems. So I built the thing that did the obvious work: extract the patient, the diagnosis, the ordered drug, the dose; run an eligibility check against the payer; match the drug to the right J-code; package it for downstream submission to FHIR.

Somewhere around the J-code matching step, I started reading more carefully. And the more I read, the more I realized that the surface I was building against — five-character alphanumeric codes that look like they were designed by a committee — was the surface of something with sixty years of policy underneath it. The denial rates everyone in revenue cycle complains about aren't a bug. They're the predictable output of a system that was bolted together piece by piece since 1965, with each piece solving a problem the previous piece created.

This is a tour of that system from a builder's perspective. If you're working on anything in the healthtech intake, eligibility, or prior auth space, the architectural debt here is the actual product surface — and the federal interoperability wave you keep hearing about is, for drug-related use cases specifically, mostly a 2027+ problem.

## How we got here: 1965 and the utilization shock

On July 30, 1965, Lyndon Johnson signed the Social Security Amendments of 1965 at the Truman Library in Independence, Missouri. Title XVIII of that law was Medicare. Title XIX was Medicaid. Harry Truman, who had tried and failed to pass national health insurance two decades earlier, was the first person to enroll.[^1]

The political fight to get there had taken years and involved stacking the House Ways and Means Committee with new Democrats after the 1964 landslide. The architects told the country it would be affordable. The 1964 projection was that Medicare would cost about $12 billion by 1990, including inflation. The actual 1990 cost was around $110 billion — roughly ten times the projection.[^2] Medicaid blew through its first-year estimate of $238 million by costing more than a billion dollars in year one.[^3] New York's state Medicaid budget, projected at $80 million by Governor Rockefeller's administration in 1966, hit $330 million three years later.[^4]

The reason the projections missed by an order of magnitude is the part that matters for this story. As soon as the program turned on, hospital admissions among the eligible population jumped 25 percent, surgical procedures rose 40 percent, and hospital days climbed 50 percent.[^5] The architects had modeled the program as if it were paying for the same volume of care that already existed, just with a different payer. But making care free at the point of service to the elderly didn't just shift who paid — it changed how much got delivered.

Once you have a federal program paying for an open-ended stream of services rendered, you need a way to describe what was rendered. Before procedure codes, providers literally wrote out free-form descriptions of what they did. A hundred providers could describe the same office visit a hundred different ways, and the program had no way to audit, price, or even count.

The American Medical Association, anticipating this, had introduced Current Procedural Terminology (CPT) in 1966 — a numeric coding system for medical, surgical, and diagnostic procedures.[^6] It was the first serious attempt at a shared vocabulary. But CPT covered physician services, not the long tail of supplies, drugs, and non-physician services that the new federal programs also had to pay for. By the late 1970s, the federal payer was looking at a coding landscape that included CPT for physician services plus more than 100 different coding schemes for everything else — drugs, durable medical equipment, ambulance, prosthetics, supplies — used variously by Medicare contractors, state Medicaid agencies, and private payers.[^7] Different schemes meant different codes for the same item, which made it impossible for Medicare to consistently price, audit, or analyze claims data across regions.

The Health Care Financing Administration (HCFA — renamed CMS in 2001) responded in two stages. In 1978 it established the HCFA Common Procedure Coding System (HCPCS) as the framework.[^8] Through the early 1980s it built out HCPCS Level II — a national alphanumeric code set that absorbed the 100+ non-physician schemes into one system, with J-codes for drugs, A-codes for ambulance and supplies, E-codes for DME, L-codes for prosthetics, and so on. In 1983, HCFA formally adopted the AMA's CPT as Level I of HCPCS and mandated the combined system for all Medicare Part B billing.[^9] State Medicaid agencies were brought in starting in 1986. HIPAA made HCPCS use mandatory across all covered entities in 1996.[^10]

When you bill a J-code today, you are using the direct descendant of what consolidated those 100+ pre-1980 drug-coding schemes. The compromise that produced HCPCS — and the source of most of the complexity I hit while building — was that the new system absorbed CPT rather than replacing it.

## The two tiers

What we call HCPCS is actually two systems stacked on top of each other.

**Level I is CPT.** It's owned and maintained by the AMA, which licenses it to everyone else. Five-digit numeric codes. Covers physician and other health-professional services and procedures: office visits (99213, 99214), infusions of administration time (96365, 96366, 96367), surgical procedures, imaging studies. The AMA convenes a CPT Editorial Panel that meets multiple times per year to add, modify, and retire codes. CMS has a non-voting liaison to the panel.

**Level II is the alphanumeric code set** — five characters starting with a letter A through V, followed by four digits. CMS owns and maintains it.[^11] This is where everything CPT doesn't cover lives:

- A codes: ambulance services, medical and surgical supplies
- B codes: enteral and parenteral therapy
- E codes: durable medical equipment
- G codes: temporary procedural codes (often for new services CMS is tracking)
- J codes: drugs administered other than orally
- L codes: orthotic and prosthetic procedures
- Q codes: temporary codes (often for new drugs awaiting permanent J codes)
- V codes: vision and hearing services

There used to be Level III local codes — codes assigned by individual Medicare contractors and state Medicaid agencies for region-specific use. They were discontinued at the end of 2003 to enforce consistency.[^12]

Then there's a third system that lives outside HCPCS entirely: ICD-10, the International Statistical Classification of Diseases. ICD is maintained by the World Health Organization, with a clinical modification (ICD-10-CM) maintained for US use. ICD-10 codes describe the diagnosis — the _why_ of the encounter. HCPCS codes describe the _what_. A typical infusion claim carries all three:

- A CPT code for the administration (e.g., 96365 — IV infusion, first hour)
- A J-code for the drug being infused
- One or more ICD-10 codes for the diagnoses justifying medical necessity

If any of the three doesn't align with the others according to the payer's coverage policy, the claim bounces. The most common bounce reason — CARC code CO-50, "non-covered services because this is not deemed a 'medical necessity' by the payer" — is almost always a code-alignment issue, not a clinical disagreement.

## A parallel system: the National Drug Code

J-codes describe drugs at the level of "what active ingredient, in what amount." That's the unit a payer uses to price the line item. But every actual product on a clinic shelf has a more specific identifier: the National Drug Code, or NDC.

The NDC system was created by the FDA under the Drug Listing Act of 1972, an amendment to the Federal Food, Drug, and Cosmetic Act. It assigns a unique 10-digit identifier to every drug product in the United States, broken into three segments:[^13]

- **Labeler code** (first segment): identifies the manufacturer, repackager, or distributor. Assigned by FDA.
- **Product code** (middle segment): identifies the specific drug formulation — active ingredient, strength, and dosage form.
- **Package code** (last segment): identifies the package size and type. A 100-count vial and a 500-count vial of the same drug have different package codes.

The 10 digits are split across the three segments in one of three configurations: 4-4-2, 5-3-2, or 5-4-1.[^14] Which configuration a labeler uses depends on their FDA assignment. For billing purposes, all NDCs get padded to 11 digits in 5-4-2 format by adding a leading zero to whichever segment is one short. This conversion is silent and easy to get wrong: depending on the original configuration, you pad in different positions, and the wrong padding produces a code that lookups will silently fail to find.

NDCs and J-codes describe drugs at different levels of granularity, and a drug claim usually carries both:

- The **J-code** is the procedure-level drug identifier, on the service line of the X12 837 claim, with units calculated against the J-code's unit definition.
- The **NDC** is the package-level drug identifier, in a separate segment of the same claim (the LIN segment in 837 5010), so the payer knows exactly which package was administered and can apply the right pricing from CMS's quarterly ASP NDC-HCPCS crosswalk.

Multiple NDCs map to a single J-code: every package size and every manufacturer of the same drug rolls up to one J-code, but each carries its own NDC. ICD-10 has no direct relationship to NDC — diagnosis codes describe why care was given, NDC describes what was administered — but they appear on the same claim and need to be consistent with the payer's coverage policy for the drug. CPT (Level I HCPCS) is even further removed: CPT codes describe the administration — the IV infusion service, billed using codes like 96365 for the first hour — and don't describe drugs at all. The NDC and the J-code together do.

## Why J-codes specifically are denial machines

Of the Level II categories, J-codes are uniquely painful. CMS data shows more than 15 percent of injectable drug claims get denied due to coding mistakes alone, well above the overall claim denial rate.[^15] Three structural reasons:

**1. Units don't equal doses.** Every J-code defines a specific dosage unit, and that unit is almost never the dose a clinician thinks in. The unit definition lives in the J-code descriptor itself, and nothing in the EHR's medication record will translate "Vivitrol 380 mg IM" into "J2315 × 380 units" automatically unless someone has wired up the mapping. A few examples:

| Drug (brand) | J-code | One unit =         | Typical adult dose                | Units billed |
| ------------ | ------ | ------------------ | --------------------------------- | ------------ |
| Vivitrol     | J2315  | 1 mg naltrexone    | 380 mg IM monthly                 | 380          |
| Remicade     | J1745  | 10 mg infliximab   | ~400 mg (5 mg/kg, 80 kg patient)  | 40           |
| Neulasta     | J2505  | 6 mg pegfilgrastim | 6 mg subcutaneous                 | 1            |
| Rituxan      | J9312  | 10 mg rituximab    | ~700 mg (375 mg/m², ~1.85 m² BSA) | 70           |

Each row is a different math. Vivitrol multiplies up — each milligram is a unit, so a 380 mg dose is 380 units. Remicade and Rituxan divide down — each unit is 10 mg of drug, so a 400 mg dose is 40 units. Neulasta is the trap: a single 6 mg dose is exactly one unit, but it's easy to mistakenly bill 6 units because the dose number happens to match the milligram number in the unit definition. Get any of these wrong — bill 1 unit instead of 380, or 6 instead of 1 — and the claim either denies for unreasonable units or pays at a fraction of the correct rate.

**2. NDC-to-J-code mapping drifts quarterly.** Drugs are also identified by National Drug Code (NDC) — an 11-digit identifier assigned by FDA. Payers cross-reference the NDC on the claim against CMS's quarterly Average Sales Price (ASP) pricing files, which tell them what to pay per unit. The NDC-to-J-code crosswalk is not stable. New NDCs get added when manufacturers introduce new package sizes or formulations. Old NDCs get retired. The 10-digit-to-11-digit NDC conversion has its own pitfalls (you have to pad with a leading zero in one of three positions depending on the segment lengths, and getting it wrong silently breaks the lookup). If your software's NDC list is six months stale, you're going to start seeing CO-16 ("claim/service lacks information") and CO-181 ("procedure code was invalid on the date of service") denials.

**3. New drugs sit in unclassified buckets for years.** When a new drug is approved, it doesn't get a permanent J-code immediately. It bills under one of the unclassified codes — J3490 (unclassified drugs), J3590 (unclassified biologics), or J9999 (unclassified antineoplastic drugs) — until CMS issues a permanent code, which can take quarters or years. Unclassified-code claims require manual pricing, additional documentation, and frequently get pended or denied while payers work out coverage. There's also a parallel temporary-code system in the Q range; a drug might cycle through Q4xxx codes before getting its permanent J-code. For an intake automation product, this means part of your J-code matching has to gracefully handle "this drug is real and FDA-approved but doesn't have a stable code yet."

The combined effect: J-codes are simultaneously the most data-rich part of an infusion claim (because drug pricing is high-stakes and tightly regulated) and the least stable (because the codes themselves churn). The denial rate is the system telling you it's hard.

## Step zero: medical benefit or pharmacy benefit?

Before any J-code matching, NDC lookup, or prior auth submission happens, an infusion clinic's intake team has to answer a more basic question: is this drug covered under the patient's medical benefit or pharmacy benefit?

For infusion drugs, this is not a rhetorical question. The same drug, for the same patient, can be covered under either side depending on the plan, and the answer determines almost everything downstream:

- **Medical benefit ("buy and bill"):** the clinic acquires the drug, administers it, and bills the payer using a J-code on a medical claim (X12 837 professional or institutional). Prior authorization, where required, goes through the medical PA process — X12 278 transactions where supported, payer portals and fax everywhere else. The clinic carries inventory risk and earns margin on drug acquisition.
- **Pharmacy benefit ("white bagging" / specialty pharmacy):** the drug is dispensed by a specialty pharmacy under the patient's pharmacy benefit and billed through the PBM via NCPDP transactions, using NDC rather than J-code. PA goes through the PBM's prior auth process, which is usually a separate system from the medical PA. The drug ships to the clinic for administration; the clinic bills only for administration.

Some payers route specific drugs to one side or the other. Some leave it to the provider. Some use rules where the same drug is medical-benefit for one indication and pharmacy-benefit for another. Pharmacy benefit carveouts add another layer — a patient's medical insurance might be one carrier while their pharmacy benefit is administered by an entirely separate PBM.

Getting this wrong is expensive. Bill a pharmacy-benefit drug on a medical claim and you get a CO-109 denial ("claim/service not covered by this payer/contractor"). Send a medical-benefit drug to the PBM and the PBM rejects it. Either way, you've burned days on the wrong workflow.

This is where eligibility data earns its keep. The X12 271 response carries Service Type Codes (STCs) that indicate which categories of benefits the patient has active coverage under. STC 30 (Health Benefit Plan Coverage) tells you general medical coverage is in place. STC 88 (Pharmacy) tells you pharmacy benefits are active. The presence or absence of pharmacy benefits in the 271 — and any carveout indicators that point to a separate PBM — is what tells you which side of the line a given drug should land on.

The intake automation problem, stated cleanly, is: take a free-text drug name from a referral form, resolve it to a candidate J-code, look up the patient's benefits, and decide whether this is a medical claim path (J-code) or a pharmacy claim path (NDC through the PBM). The branching decision is the hard part. Everything downstream — coverage check, prior auth, claim formatting — depends on getting that branch right.

## How healthcare data actually moves: the X12 era

All of the back-and-forth I've described so far — eligibility checks, prior authorizations, claims — happens through a specific format called X12 EDI. It's worth understanding because it's what FHIR is layered on top of, and what most of healthcare's plumbing still runs on.

EDI (Electronic Data Interchange) emerged in the 1960s as industries began moving paper-based business documents — purchase orders, invoices, shipping manifests — into computer-to-computer transmission. Different industries developed their own formats. To consolidate, the American National Standards Institute chartered the Accredited Standards Committee X12 (ASC X12) in 1979 to develop and maintain national EDI standards across industries.[^16]

X12 standards are organized around transaction sets — numbered specifications for specific business documents. Healthcare adopted a subset of these:

- 270 / 271: eligibility request and response
- 276 / 277: claim status request and response
- 278: prior authorization request and response (referral, certification, services review)
- 820: premium payment
- 834: benefit enrollment and maintenance
- 835: claim payment and remittance advice (the ERA)
- 837: healthcare claim — sub-flavors for professional (837P), institutional (837I), and dental (837D)

Healthcare's adoption of X12 was scattered until HIPAA in 1996, which directed HHS to designate national standards for electronic healthcare transactions. The Transactions and Code Sets Final Rule, effective in 2003, mandated specific X12 4010 versions of these transactions for HIPAA-covered entities. In 2012, the standard was upgraded to X12 5010, which is still the mandated version today.[^17]

X12 transactions are notoriously rigid. Each transaction is a flat, segment-based string with delimiters between fields and segments. A 271 eligibility response is a wall of pipe-and-tilde-separated text, with information packed into nested loops that have to be parsed by walking through them in order. Modern API vendors — Stedi, Availity, Change Healthcare's APIs, Waystar — wrap these transactions in JSON, but underneath, the payer is still receiving and emitting the same EDI strings. The JSON wrapper is convenience for developers; the wire protocol is X12.

This is the world FHIR is supposed to gradually replace.

## The FHIR shift, and the drug-shaped hole in it

The most important regulatory change of the last few years is CMS-0057-F, the Interoperability and Prior Authorization Final Rule, finalized in early 2024.[^18] The rule mandates that "impacted payers" — Medicare Advantage organizations, state Medicaid and CHIP fee-for-service programs, Medicaid managed care plans, CHIP managed care entities, and Qualified Health Plan issuers on the federally-facilitated exchanges — implement FHIR-based APIs for prior authorization and several adjacent flows.

The compliance timeline is staggered:[^19]

- **January 1, 2026:** Operational provisions kick in. Payers must turn around prior authorization decisions within 72 hours for urgent requests and 7 calendar days for standard requests, must provide specific denial reasons, and must begin collecting metrics for public reporting.
- **March 31, 2026:** First public reporting of CY2025 prior authorization metrics is due.
- **January 1, 2027:** Full FHIR API compliance. Patient Access API, Provider Access API, Provider Directory API, Payer-to-Payer API, and Prior Authorization API all must be live.

The Prior Authorization API is the headline feature. The HL7 Da Vinci accelerator has produced three implementation guides that together describe how electronic prior auth is supposed to work end-to-end:

- **CRD (Coverage Requirements Discovery):** the provider's EHR asks the payer's API "is prior auth required for this service?" and gets back yes/no plus what's needed.
- **DTR (Documentation Templates and Rules):** the payer hands back structured documentation requirements that the EHR can pre-fill from the chart.
- **PAS (Prior Authorization Support):** the actual submission and decision exchange, layered on top of the legacy X12 278 transaction format where needed.

If you've been hearing breathless takes about how 2026 is the year prior auth gets fixed, this is what they're pointing to.

Here's the part that surprised me: **the prior authorization API mandate explicitly excludes drugs.**

The Patient Access API expansion includes prior authorization information "excluding those for drugs." The Prior Authorization API requirement is for "items and services" — a phrase that, in CMS rule-writing, specifically does not include drug benefit prior authorizations.[^20] Drug PA is being addressed in a separate, later rule: CMS-0062-P, the 2026 Interoperability Standards and Prior Authorization for Drugs proposed rule, which is still in proposed status as of this writing.[^21]

So the federal interoperability wave that's hitting the rest of healthcare in 2026 and 2027 — the wave that produced the FHIR APIs I was prepping data for — does not, in its current form, cover the exact use case I was automating. Infusion drugs are drugs. Drug PA is excluded. My referral inbox was packaging data for FHIR submission to a Prior Authorization API that, for the drugs the clinic actually administers, isn't required to exist yet.

## What I actually built

Now you have all the background. Here's what the unified referral inbox actually did, and where each piece sat in the system I just described.

**The pipeline.** A referral lands as a fax or scanned PDF from a referring physician's office, carrying patient demographics, the ordered drug, dose, frequency, and a diagnosis. The inbox extracts the structured fields, runs an eligibility check, resolves the drug name to a candidate J-code, decides whether the drug should be billed under medical or pharmacy benefit, and packages the result for downstream submission. That packaging step is where I targeted FHIR — and where, as the previous section makes clear, I'd misread the regulatory landscape.

**Where Stedi fit.** Stedi handled three transaction types I cared about: insurance discovery, eligibility, and (in the would-be future) claim submission. Their eligibility API wraps X12 270/271 in JSON and returns service type codes and benefit information in a structured response, which made the medical-vs-pharmacy determination tractable in code instead of requiring an EDI parser. Their insurance discovery API — finding coverage from patient demographics alone — handled a recurring intake failure mode where the referring office hadn't captured insurance correctly or the patient brought an outdated card. The mapping from a J-code to the appropriate service category for the eligibility lookup, so you can ask the right STC question in the 270 and interpret the right STCs in the 271, was the kind of logic their docs and code lists actually helped me reason about.

**Where Stedi explicitly didn't fit.** Prior authorization submission. Stedi's product surface covers eligibility, insurance discovery, and claims — the upstream and downstream of the workflow — but not the PA in the middle. Drug PA in particular still routes through X12 278 transactions where the payer supports them, payer portals where they don't, and a long tail of fax and phone for the rest. Knowing where Stedi's surface ended saved me from designing the wrong abstraction at the PA step.

**The claim I didn't build.** After PA approval — by whatever route — the payer issues an authorization number. That number is the connective tissue between the PA decision and the eventual claim. It rides on a specific loop of the X12 837 (REF segment, G1 qualifier), and a missing or wrong auth number is the most common reason an otherwise-correct claim earns a CO-197 denial ("precertification/authorization/notification absent"). For an infusion encounter, the claim itself is a packaging job:

- Patient and provider demographics
- Diagnosis codes (ICD-10) for medical necessity
- The CPT administration code (96365 for the first hour of IV infusion, 96366 for each additional hour)
- The J-code for the drug, with units matched to the dose delivered
- The NDC of the specific package
- The authorization number from PA, in the right segment of the 837
- Service date, place of service, charges

This is where Stedi's claims API would have come in if I'd kept building. Their professional claims endpoint (837P) accepts a JSON payload describing the encounter and handles the X12 generation and routing through their network. Real-time claim status checks (276/277) would close the loop on whether the claim made it to the payer and was accepted. I didn't get that far. The unified referral inbox stopped at "this referral is structured, eligibility is verified, here is the candidate J-code with units, here is the medical-vs-pharmacy decision."

**What I'd misread about FHIR.** The intake and eligibility layers of what I built were aimed at the right target. Insurance discovery and 270/271 eligibility through Stedi, J-code resolution from the referral's drug name, medical-vs-pharmacy benefit determination off the service type codes in the 271 — all of that is the existing-world stack and will keep being so for drug-intake workflows for the foreseeable future. The piece that didn't have a destination was the last mile: the assumption that I could hand a finished prior auth packet to a FHIR API and have it adjudicated. For the medical-side prior auths the clinic also processes (imaging, infusion administration codes, DME), the FHIR Prior Authorization API will start mattering in 2027. For the drug PA itself, the realistic destinations remain X12 278 where supported, payer portals where not, and a still-uncomfortable amount of fax and phone for the long tail.

## What this means if you're building in this space

A few takeaways from the build, in case any of this is useful:

**The codes are the product surface, not an implementation detail.** I underestimated this. The mapping between "what the referring physician wrote" and "what the payer will adjudicate" is the actual hard problem, and the J-code unit logic is where most of that hardness concentrates. A matching layer that handles unit math, NDC drift, and unclassified-code fallbacks correctly is more valuable than a clean React frontend.

**Don't skip the regulatory text.** I had read enough about CMS-0057-F to know FHIR was coming. I had not read closely enough to notice that drugs were carved out. The rule itself isn't long by federal standards, and the practical scope information is in the executive summaries CMS publishes alongside it. An hour with the actual rule would have changed the architecture I designed.

**Eligibility is the most reusable thing you build.** The 270/271 layer — and especially the service type codes returned in the 271 — is stable, well-understood, and useful in every downstream workflow. It tells you which benefit applies, which routes the rest of your branching: medical claim path or pharmacy claim path, medical PA process or PBM PA process. If you're prototyping in this space, the eligibility check is the piece of infrastructure that ages best.

**Be honest about the timeline.** The "FHIR everything by 2027" framing is real for medical PA, Patient Access, Payer-to-Payer, and Provider Access. For drug PA specifically, the federal mandate is a separate, later, still-proposed rule. Investors and customers in the infusion space deserve to hear that distinction clearly, not folded into a generic "interoperability is here" pitch.

The codes, viewed from above, look like a mess. Viewed from the inside, they look like sixty years of policy compromises stacked on top of each other, each one solving a real problem and creating a new one. The denial rates, the unit math, the quarterly NDC churn, the unclassified-J-code purgatory — none of it is arbitrary. It's just deeply, structurally path-dependent.

The good news, if you can call it that, is that the structure isn't going anywhere. Whatever you build to handle it now will still be relevant a decade from now. The FHIR layer is going on top of HCPCS, not replacing it.

---

_If you're building in this space and want to compare notes, I'd love to hear what you're seeing. Especially if you've found a clean way to handle the NDC-to-J-code mapping problem — that one is still mostly duct tape on my end._

[^1]: National Archives, "Medicare and Medicaid Act (1965)." https://www.archives.gov/milestone-documents/medicare-and-medicaid-act ; LBJ Presidential Library, "Medicare and Medicaid." https://www.lbjlibrary.org/news-and-press/media-kits/medicare-and-medicaid ; Social Security Administration, "President Truman as First Medicare Beneficiary." https://www.ssa.gov/history/lbjsm.html

[^2]: Chris Edwards, "Medicare Reforms," Cato / Downsizing the Federal Government. The 1967 House Ways and Means estimate projected total Medicare spending of $12 billion in 1990; actual 1990 cost was $110 billion. https://www.downsizinggovernment.org/hhs/medicare-reforms

[^3]: John Daniel Davidson, "50 Years Later, Medicaid, Medicare Still Spend Us Into Oblivion," _The Federalist_ (July 31, 2015). Cites the 1965 House Ways and Means estimate of $238 million for Medicaid's first year against an actual cost above $1 billion. https://thefederalist.com/2015/07/31/medicare-medicaid-same-problems-50-years-ago/

[^4]: Texas Public Policy Foundation, "50 Years Later, Medicaid and Medicare Still Spend Us Into Oblivion" (July 31, 2015). https://www.texaspolicy.com/50-years-later-medicaid-and-medicare-still-spend-us-into-oblivion/

[^5]: General context on the post-Medicare utilization surge: Newhouse and others on the impact of Medicare on hospital use (CMS Health Care Financing Review); James C. Capretta, "Saving Medicare from Itself," _National Affairs_. https://www.nationalaffairs.com/publications/detail/saving-medicare-from-itself . The specific magnitudes vary by source and subpopulation; readers should treat the figures as directional rather than exact.

[^6]: Erik H. Hoyer et al., "Current Procedural Terminology: History, Structure, and Relationship to Valuation for the Neuroradiologist," _American Journal of Neuroradiology_ 37, no. 11 (Nov 2016): 1972–1976. https://www.ajnr.org/content/37/11/1972

[^7]: AAPC, "HCPCS Codes." Describes the proliferation of more than 100 coding systems in use before HCPCS consolidation. https://www.aapc.com/resources/what-are-hcpcs-codes

[^8]: CMS, "Healthcare Common Procedure Coding System (HCPCS)." https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system

[^9]: AAPC, "HCPCS Codes" (1983 merger of HCFA Common Procedure Coding System with CPT, mandate for Medicare Part B billing).

[^10]: 45 CFR 162 and HIPAA Administrative Simplification provisions; see CMS, "Transactions Overview." https://www.cms.gov/regulations-and-guidance/administrative-simplification/transactions/transactionsoverview

[^11]: CMS, "HCPCS — General Information." https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system

[^12]: CMS, "HCPCS Level II Coding Procedures" — Level III local codes were discontinued December 31, 2003 under HIPAA, with the deadline extended from October 2002 by section 532(a) of BIPA. https://www.cms.gov/Medicare/Coding/MedHCPCSGenInfo/downloads/HCPCSLevelIICodingProcedures7-2011.pdf

[^13]: FDA, "National Drug Code Database Background Information." https://www.fda.gov/drugs/development-approval-process-drugs/national-drug-code-database-background-information

[^14]: FDA, NDC Directory background documentation (configurations 4-4-2, 5-3-2, 5-4-1). Note that FDA finalized a rule in 2026 transitioning to a uniform 12-digit format effective March 7, 2033; the configurations described here reflect the current pre-transition state. https://www.federalregister.gov/documents/2026/03/05/2026-04368/revising-the-national-drug-code-format-and-drug-label-barcode-requirements

[^15]: P3Care, "J-Codes in Medical Billing: Quick Guide for Accurate Claims," citing CMS reporting on injectable drug claim denial rates above 15 percent. https://www.p3care.com/blog/j-codes-in-medical-billing/ . Other industry sources put the figure in a similar range (e.g., 14% per CMS Q1 2025 outpatient denial data referenced by Vigilant Billing).

[^16]: ASC X12 was chartered by ANSI in 1979 to develop national EDI standards. ASC X12, "About." https://x12.org/about ; see also Wikipedia, "ASC X12." https://en.wikipedia.org/wiki/ASC_X12

[^17]: CMS, "HHS Modifies HIPAA Code Sets (ICD-10) and Electronic Transactions Standards" — Transactions and Code Sets Final Rule effective October 16, 2003 (Version 4010/4010A1), modified by the January 2009 rule adopting Version 5010 with a compliance date of January 1, 2012. https://www.cms.gov/newsroom/fact-sheets/hhs-modifies-hipaa-code-sets-icd-10-and-electronic-transactions-standards

[^18]: CMS, "CMS Interoperability and Prior Authorization Final Rule CMS-0057-F" (finalized January 17, 2024; published in the Federal Register February 8, 2024). https://www.cms.gov/newsroom/fact-sheets/cms-interoperability-prior-authorization-final-rule-cms-0057-f

[^19]: CMS-0057-F final rule document, sections on compliance dates for operational provisions (generally Jan 1, 2026) and API development requirements (generally Jan 1, 2027). https://www.cms.gov/files/document/cms-0057-f.pdf

[^20]: CMS, "Interoperability and Prior Authorization FAQs — General." Explicitly states that CMS excluded drugs from both the Prior Authorization API and the process requirements in CMS-0057-F. https://www.cms.gov/priorities/burden-reduction/overview/interoperability/frequently-asked-questions/general ; see also Rachel Sachs et al., "Understanding CMS's Proposed Rule Regarding Prior Authorization For Drugs," _Health Affairs Forefront_ (May 2026). https://www.healthaffairs.org/content/forefront/understanding-cms-s-proposed-rule-regarding-prior-authorization-drugs

[^21]: CMS, "2026 CMS Interoperability Standards and Prior Authorization for Drugs Proposed Rule (CMS-0062-P)." https://www.cms.gov/priorities/burden-reduction/overview/interoperability/policies-regulations/cms-interoperability-standards-prior-authorization-drugs-proposed-rule-cms-0062-p
