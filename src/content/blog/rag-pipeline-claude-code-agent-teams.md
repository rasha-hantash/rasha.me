---
title: "A/B Testing Your RAG Pipeline: Chunking, Retrieval, and Reranking Strategies You Can Build With One Prompt Each"
pubDate: 2026-02-16
description: "How to quickly build and compare RAG pipeline variants — cosine vs. hybrid search, fixed vs. semantic chunking, Cohere vs. cross-encoder reranking — using Claude Code agent teams, Graphite stacks, and your own offline evals."
tags: ["rag", "claude-code", "ai-agents", "graphite", "evaluation"]
draft: false
---

You've built a RAG pipeline. It works. PDFs go in, answers come out. But is it the *right* pipeline? Are your chunks too big? Is cosine similarity leaving relevant passages on the floor? Would a reranker actually improve your answers, or just add latency?

The only way to know is to test it. Swap one component, run your eval suite, compare the results.

The problem is that building each variant takes time. Different chunking strategies, different retrieval methods, different reranking backends — each one touches multiple files across parsing, storage, retrieval, and generation. That's where the workflow comes in: one prompt to a Claude Code agent team produces a working variant. <a href="https://graphite.dev" target="_blank">Graphite</a> stacks each variant as a separate, reviewable PR — so you can compare isolated diffs instead of untangling one massive branch. You run your evals against each branch, compare the numbers, and merge the winner.

This article walks through six axes of variation in a RAG pipeline, gives you the prompt to build each variant, and explains what to look for in your eval results. The codebase is a document Q&A system over legal PDFs — pgvector, FastAPI, React frontend with bounding box highlights — but the strategies generalize to any RAG system.

<a href="https://github.com/rasha-hantash/pdf-classaction-rag" target="_blank">Here's the repo</a> if you want to skip ahead.

---

## The Baseline: What You're Comparing Against

Every comparison needs a baseline. Here's the prompt that builds the foundation — a working RAG pipeline with the simplest retrieval strategy (pure cosine similarity, semantic chunking, no reranking):

```
Build a RAG pipeline for querying PDF documents. Use Graphite (gt) to stack
each feature as a separate PR.

Tech: Python FastAPI, PostgreSQL + pgvector, PyMuPDF for PDF parsing,
OpenAI text-embedding-3-small for embeddings, Claude for answer generation,
React + TanStack Router frontend.

PR 1: Infrastructure + data models — docker-compose with pgvector,
      database migrations (documents + chunks tables with vector(1536)),
      PgVectorStore class with cosine similarity search using <=>.

PR 2: Ingestion pipeline — PyMuPDF PDF parsing with Tesseract OCR
      fallback for scanned pages (detect low text content per page,
      render to pixmap, run pytesseract.image_to_string), garbage text
      detection for corrupted font encodings. Semantic chunking (split
      by paragraph boundaries, merge small paragraphs, fixed-size
      fallback for large blocks). OpenAI embedding generation with
      token-based batching and retry logic, batch upload with
      ThreadPoolExecutor.

PR 3: Retrieval + API — embed query -> cosine similarity search ->
      top_k results -> build context -> Claude generates answer with source
      references. POST /api/v1/rag/query, GET /api/v1/documents.

PR 4: Frontend — TanStack Router, split-pane layout with chat panel and
      evidence panel, document upload, react-pdf viewer with bounding box
      highlights on cited passages.

Use `gt create` for each PR and `gt submit --no-interactive` when done.
```

This gives you: PDF upload → semantic chunking → embed → cosine similarity retrieval → Claude answer with source highlights. It works. For many use cases, it's enough. But your eval suite will tell you where it falls short — and that's where the variants come in.

The entire persistence layer is two tables:

```sql
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_hash VARCHAR(64) NOT NULL UNIQUE,
    file_path TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    chunk_type VARCHAR(50),
    page_number INTEGER,
    position INTEGER,
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

## Measuring the Difference: Offline Evals

None of these strategy changes matter if you can't measure the impact. You need an offline, reference-based eval suite — a set of questions with known answers that you run against each variant. Compare retrieval precision, recall, and answer faithfulness across branches. The variant with better scores wins.

I'll be writing a full article on building an eval framework for RAG pipelines. In the meantime, <a href="https://www.youtube.com/watch?v=a3SMraZWNNs" target="_blank">this video</a> is a good starting point for thinking about evals.

---

## Strategy 1: Chunking — Fixed-Size vs. Semantic

The first thing to A/B test is how you split your documents. Chunking happens before anything else in the pipeline — it determines what your embeddings represent, what your retriever can find, and ultimately what context your LLM sees.

### What each strategy does

**Fixed-size chunking** splits text into chunks of N characters with M characters of overlap. It's predictable — every chunk is roughly the same size, which means embedding quality is consistent and you know exactly how many chunks fit in a context window. The downside is that it cuts through paragraphs, sentences, even words. A key passage might be split across two chunks, diluting both.

**Semantic chunking** (what this pipeline calls `semantic_chunking_by_paragraphs`) splits on paragraph boundaries and merges small paragraphs until a max size is reached. Large paragraphs that exceed the max get a fixed-size fallback. This preserves logical units of thought — a complete argument, a full clause, a table caption with its table — at the cost of variable chunk sizes.

### The prompt

Your baseline already uses semantic chunking. To build the fixed-size variant for comparison:

```
Create a new branch from the current ingestion PR. Change the default
chunking strategy from "semantic" to "fixed" in the ingestion pipeline.

The fixed_size_chunking function already exists in chunking.py with
chunk_size=1000 and overlap=200. Wire it as the default in
RAGIngestionPipeline and the ingest_document function.

Add a CHUNKING_STRATEGY env var (values: "semantic" or "fixed",
default "semantic") so both strategies can be toggled without code changes.

Use gt create for this branch.
```

### What to look for in your evals

**Fixed-size chunking** tends to win on recall for needle-in-a-haystack queries — where the answer is a single sentence buried in a document. Because every chunk overlaps with its neighbors, the relevant sentence appears in at least one chunk (often two). But it tends to lose on answer quality for complex questions, because the LLM receives fragments instead of complete thoughts.

**Semantic chunking** tends to win on coherence and answer quality. When the LLM gets a complete paragraph as context, it produces better-sourced, more precise answers. But if your paragraphs are very long (1500+ characters), important details might get buried in a large chunk that the embedding model can't represent well — longer chunks produce embeddings that average over more content, making it harder for any single detail to drive retrieval.

Watch for: retrieval precision (are the right chunks being found?), answer faithfulness (is the LLM hallucinating because it got a fragment instead of a complete passage?), and chunk count per query (are you using more chunks than necessary because they're too small?).

---

## Strategy 2: PDF Parsing — PyMuPDF vs. Reducto

Parsing is upstream of everything. If the parser misses text, misclassifies a heading, or mangles a table, no amount of retrieval sophistication will fix it.

### What each strategy does

**PyMuPDF** is a local, open-source parser. It extracts text blocks with font size, bold detection, and bounding box coordinates. It handles tables via PyMuPDF's built-in table finder. For scanned documents, it detects low text content and falls back to Tesseract OCR page-by-page. It also detects garbage text (corrupted font encodings) and OCRs those pages automatically. Zero API calls, zero cost, full control.

**Reducto** is a cloud API purpose-built for document parsing. It handles OCR internally, extracts tables from HTML, classifies block types (title, section header, list item, paragraph), and returns normalized bounding boxes. It's better at complex layouts — multi-column PDFs, forms, documents with mixed text and images. But it adds latency (network round-trip), costs per page, and requires an API key.

### The prompt

```
Add Reducto as an alternative PDF parser. Create a ReductoParser class
that wraps the Reducto SDK (reductoai package). It should:

- Upload the PDF via client.upload(), parse via client.parse.run()
- Map Reducto block types to our internal types: "title"/"section header"
  -> "heading", "list item" -> "list_item", everything else -> "paragraph"
- Convert Reducto bbox format {left, top, width, height} to [x0, y0, x1, y1]
- Parse HTML table content into headers and rows
- Return the same ParsedDocument model that PyMuPDF returns

Add a PDF_PARSER env var (values: "pymupdf" or "reducto", default "pymupdf")
to toggle between parsers. Wire it through parse_pdf() and the server lifespan.
Reducto requires REDUCTO_API_KEY env var.

Use gt create for this branch.
```

### What to look for in your evals

Run the same queries against documents ingested with each parser. **PyMuPDF** will struggle with scanned documents (even with OCR fallback, Tesseract quality varies), complex layouts (multi-column text gets interleaved), and PDFs with corrupted font encodings (the garbage text detection catches some but not all). **Reducto** will produce cleaner chunks for complex documents but may be overkill for simple, text-heavy PDFs where PyMuPDF extracts perfectly.

Watch for: chunk quality (read the actual chunks — are they coherent?), table extraction accuracy (are table rows intact?), and ingestion latency (Reducto adds network time). If your documents are straightforward text-heavy PDFs, PyMuPDF probably wins on speed and cost with comparable quality. If you're dealing with scanned legal filings, medical forms, or multi-column layouts, Reducto is likely worth the cost.

---

## Strategy 3: Retrieval — Cosine Similarity vs. Hybrid Search (RRF)

This is the highest-impact change in the pipeline. Retrieval determines what the LLM sees — and a better retrieval strategy means better answers without changing anything else.

### What each strategy does

**Cosine similarity** (the baseline) embeds your query and finds the nearest chunks by vector distance. It understands meaning — if your PDF says "securities fraud class action" and you ask about "legal violations in the stock market," embeddings will find the match because the concepts are semantically close. But if you search for the exact phrase "securities fraud class action" — the literal words in the document — pure vector search can rank a semantically-similar-but-not-exact passage higher.

**Hybrid search with RRF** runs two searches in parallel: cosine similarity (semantic) and BM25 full-text search (keyword). BM25 is the algorithm that powered search engines before embeddings existed — it matches on term frequency, catches exact terminology, proper nouns, case numbers, and legal citations that embeddings might blur. Reciprocal Rank Fusion combines both ranked lists using `1 / (k + rank)` with k=60, then sums across lists. A chunk that ranks highly in *both* methods gets a higher combined score than one that only appears in one.

### The prompt

```
Add BM25 hybrid search to the retrieval pipeline.

Database change: Add a search_vector tsvector column to the chunks table,
generated always from content using to_tsvector('english', content), with a
GIN index. This is a zero-ingestion-change — PostgreSQL auto-populates it.
Note: the generated column approach means you can't preprocess text (e.g., stripping markdown or special characters) before indexing — if your documents have non-standard characters that degrade BM25 quality, consider a trigger-based approach instead.

New methods on PgVectorStore:
- _bm25_search(query, top_k): full-text search using plainto_tsquery and
  ts_rank, returns list[SearchResult]
- hybrid_search(query_embedding, query, top_k, rrf_k=60): over-fetch from
  both vector search and BM25 (fetch_k = top_k * 3), combine with
  Reciprocal Rank Fusion, deduplicate on chunk_id, return top_k

Update RAGRetriever to call hybrid_search instead of similarity_search.

Add a RETRIEVAL_STRATEGY env var (values: "cosine" or "hybrid",
default "hybrid") so the baseline can be toggled back for comparison.

Use gt create for this branch.
```

### A worked example: how strategies diverge

Let's make this concrete. Imagine a small corpus of 10 chunks and the query: **"How do I handle authentication token refresh in microservices?"**

**With cosine similarity only (top_k=5):**

| Rank | Chunk | Cosine |
|:-----|:------|:-------|
| 1 | C1 — JWT refresh token rotation | 0.82 |
| 2 | C2 — OAuth2 token lifecycle | 0.71 |
| 3 | C3 — Microservice auth with mTLS | 0.58 |
| 4 | C10 — gRPC interceptors for auth | 0.44 |
| 5 | C4 — Session management in monoliths | 0.35 |

C4 (session management in monoliths) squeaks in at rank 5. It's semantically adjacent but not useful. Meanwhile, C8 (token bucket algorithm) didn't make the cut at cosine 0.29.

<br>

**With hybrid search (cosine + BM25 + RRF):**

BM25 produces its own ranking based on keyword matches:

| Rank | Chunk | BM25 |
|:-----|:------|:-----|
| 1 | C1 — JWT refresh token rotation | 12.4 |
| 2 | C10 — gRPC interceptors for auth | 9.8 |
| 3 | C3 — Microservice auth with mTLS | 7.2 |
| 4 | C8 — Token bucket algorithm | 6.1 |
| 5 | C2 — OAuth2 token lifecycle | 5.3 |

C8 shows up because it literally contains the word "token." C10 jumped to rank 2 because it contains "auth" — BM25 catches lexical matches the embedding model underweighted.

<br>

**RRF fuses both lists with `1 / (60 + rank)`:**

| Chunk | Vector Rank | Keyword Rank | RRF Score |
|:------|:------------|:-------------|:----------|
| C1 | 1 | 1 | 1/61 + 1/61 = **0.0328** |
| C10 | 4 | 2 | 1/64 + 1/62 = **0.0318** |
| C3 | 3 | 3 | 1/63 + 1/63 = **0.0317** |
| C2 | 2 | 5 | 1/62 + 1/65 = **0.0315** |
| C8 | — | 4 | 0 + 1/64 = **0.0156** |
| C4 | 5 | — | 1/65 + 0 = **0.0154** |

C4 and C8 are naturally suppressed — they only appeared in one list, so they get roughly half the RRF score. No threshold tuning needed. C10 jumped from vector rank 4 to fused rank 2 because it's strong in both modalities.

    
### What to look for in your evals

Hybrid search almost always improves retrieval quality over pure cosine. The question is by how much, and whether the added complexity is worth it for your use case.

Watch for: recall on queries with exact terminology (case numbers, legal citations, proper nouns — BM25 catches these), precision on semantic queries (hybrid shouldn't degrade what cosine already does well), and latency (hybrid runs two searches, though the BM25 query is fast with a GIN index).

The `k=60` in RRF comes from the <a href="https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf" target="_blank">original paper (Cormack et al., 2009)</a>. High k compresses rank differences — being rank 1 vs. rank 5 barely matters, which is what you want when fusing two systems that measure fundamentally different things. Most production implementations (including Elasticsearch's) just use 60.

### A note on cosine thresholds

You might be tempted to add a hard cosine similarity threshold (e.g., only return results with score >= 0.3). This pipeline intentionally doesn't. A fixed cutoff is fragile — the "right" number depends on your embedding model, your domain, and your chunk sizes. With a small corpus, 0.3 might return zero results for a valid question. With a large corpus, hundreds of mediocre chunks might clear it. Top_k ranking combined with RRF fusion and reranking is a more robust quality gate — RRF naturally suppresses low-quality candidates, and the reranker evaluates actual query-passage relevance with a model trained for that task.

---

## Strategy 4: Reranking — None vs. Cohere vs. Cross-Encoder

Retrieval (whether cosine or hybrid) produces a ranked list using embedding geometry and term frequency. Neither actually reads the query and the passage together to judge relevance. That's what a reranker does — it takes the query and each candidate passage, feeds them through a model trained specifically for relevance scoring, and re-orders the list.

### What each strategy does

**No reranker** (the baseline) returns whatever the retriever produces. Fast, simple, no additional cost. Fine when your retrieval is already strong and your queries are straightforward.

**Cohere reranker** (`rerank-v3.5`) is an API call. You send the query and candidate passages, get back relevance scores. It's the most accurate option — Cohere's model is trained on massive relevance datasets. But it adds 200-400ms of latency and a per-call cost.

**Local cross-encoder** (`cross-encoder/ms-marco-MiniLM-L-6-v2` from sentence-transformers) runs on your machine. It scores (query, passage) pairs locally. Adds ~50-150ms with a GPU, more on CPU. No API key, no cost after model download. Less accurate than Cohere but significantly faster. Note that this model is trained on MS MARCO (web search passages) — for domain-specific retrieval like legal documents, a fine-tuned or domain-trained model may perform better.

Both rerankers use the same interface — the retriever over-fetches 4x candidates (fetch_k = top_k * 4) to give the reranker a large pool, then cuts back to top_k after reranking.

### The prompt

```
Add a reranker interface with two backends.

Abstract Reranker base class with rerank(query, results, top_k) method.

Cohere backend: uses cohere SDK, rerank-v3.5 model, maps relevance scores
back to SearchResult objects. Requires COHERE_API_KEY. Make cohere an
optional dependency with try/except import guard.

Local cross-encoder backend: uses sentence-transformers
cross-encoder/ms-marco-MiniLM-L-6-v2, scores (query, passage) pairs locally.
Make sentence-transformers an optional dependency with try/except import guard.

Update RAGRetriever: accept optional Reranker in constructor. When reranker
is present, over-fetch 4x (fetch_k = top_k * 4), pass candidates through
reranker, return top_k. When absent, fetch exactly top_k as before.

Add RERANKER env var (values: "cohere", "cross-encoder", or empty for none).
Wire it in server lifespan.

Use gt create for this branch.
```

### Continuing the worked example

Taking the RRF output from [the example in Strategy 3](#a-worked-example-how-strategies-diverge), here's what the reranker does:

| Chunk | RRF Rank | Reranker Score | Final Rank |
|:------|:---------|:---------------|:----------|
| C1 — JWT refresh token rotation | 1 | 0.94 | **1** |
| C2 — OAuth2 token lifecycle in distributed systems | 4 | 0.88 | **2** |
| C10 — gRPC interceptors for auth propagation | 2 | 0.72 | **3** |
| C3 — Microservice auth with mTLS | 3 | 0.65 | **4** |
| C8 — Token bucket algorithm | 5 | 0.08 | **5** |
| C4 — Session management in monoliths | 6 | 0.12 | **6** |

C2 jumped from 4th to 2nd — the reranker understood that "OAuth2 token lifecycle in distributed systems" is deeply relevant to the query, even though RRF had it slightly lower. C8 cratered to 0.08 — the reranker read the passage and recognized that "token bucket for throttling" has nothing to do with auth token refresh. BM25 was fooled by the word "token"; the reranker wasn't.

### What to look for in your evals

The reranker's impact scales with corpus size and query ambiguity. For a small corpus with clear queries, the retriever alone often gets the right chunks — the reranker just confirms the order. For a large corpus with nuanced queries, reranking can dramatically improve precision.

Compare three configurations against your eval suite: no reranker, Cohere, and cross-encoder. Track retrieval precision, answer quality, and latency. Cohere will likely produce the best retrieval precision but adds the most latency and cost. The cross-encoder is the middle ground — better than no reranker, cheaper and faster than Cohere. No reranker wins on speed.

The over-fetch multiplier matters too. 4x is a reasonable default, but if your evals show the reranker frequently promoting a chunk from rank 15+ to the top 5, you might want to increase it. If the reranker mostly confirms the existing order, 2x might be sufficient and faster.

---

## Strategy 5: Embedding Model — text-embedding-3-small vs. text-embedding-3-large

The embedding model determines the quality of your vector representations — and by extension, the quality of every vector-based operation in the pipeline: cosine similarity search, the vector half of hybrid search, and the initial candidate pool that the reranker evaluates.

### What each model does

**text-embedding-3-small** (1536 dimensions) is OpenAI's compact embedding model. It's fast, cheap ($0.02 per million tokens as of February 2026 — <a href="https://openai.com/api/pricing/" target="_blank">check current pricing</a>), and produces good-quality embeddings for most use cases. For straightforward text where the semantic relationships are clear — "securities fraud" matching "legal violations" — it works well.

**text-embedding-3-large** (3072 dimensions) is the higher-fidelity model. It captures finer-grained semantic distinctions — subtle differences in legal terminology, technical jargon, or domain-specific language that the small model might blur together. It costs roughly 6.5x more ($0.13 per million tokens as of February 2026) and produces vectors twice the size, which means double the storage in pgvector and slightly slower similarity searches.

### The prompt

```
Switch the embedding model from text-embedding-3-small to text-embedding-3-large.

Update the vector column dimension from 1536 to 3072 in the database migration.
Update the EmbeddingGenerator to use "text-embedding-3-large" as the model name.
Update any hardcoded vector(1536) references to vector(3072).

Add an EMBEDDING_MODEL env var (values: "text-embedding-3-small" or
"text-embedding-3-large", default "text-embedding-3-small") and wire the
dimension (1536 or 3072) to follow the model choice.

Use gt create for this branch.
```

### What to look for in your evals

Switching models isn't a runtime toggle — it requires a new migration to alter the vector column dimension and re-ingesting your entire corpus, since embeddings change with the model. You can't compare retrieval results against the same stored chunks. Ingest once with each model, then run your eval suite against both.

**text-embedding-3-large** tends to improve retrieval precision on domain-specific queries where the vocabulary is specialized. Legal documents, medical records, and technical specifications benefit most — the larger model captures subtle distinctions (e.g., "breach of fiduciary duty" vs. "breach of contract") that the small model might conflate.

**text-embedding-3-small** is often sufficient for general-purpose text where the semantic relationships are straightforward. If your eval scores don't improve meaningfully with the large model, the small model wins on cost and speed.

Watch for: retrieval precision delta (is the large model actually finding better chunks?), ingestion cost (the large model costs 6.5x more per token), storage impact (3072-dim vectors use twice the disk and memory), and query latency (similarity search over larger vectors is slightly slower).

---

## Strategy 6: Putting It All Together — Sizing top_k

top_k isn't a strategy you A/B test in isolation — it interacts with everything else. But it's worth testing across your other variants because the right value depends on which strategies you've chosen.

There's no universal right answer. The real question is: how many chunks does your LLM need to answer the question well?

Too few (top_k=2) and you risk missing a relevant passage. The answer might span two chunks, or the best evidence might be ranked 3rd by one search method. Too many (top_k=50) and you're stuffing the context window with noise, increasing latency and token cost.

For most RAG systems, top_k between 3 and 10 is the practical range. Where you land depends on:

**Corpus size.** A handful of PDFs (5-10 documents, a few hundred chunks) — top_k of 3-5 is usually enough. Hundreds of documents with thousands of chunks — bump to 8-10, because the answer is more likely distributed across multiple sources.

**Chunk size.** Small, granular chunks (~200 tokens) need a higher top_k (8-10) to cover enough context. Paragraph-level chunks (~500-800 tokens) often work with 3-5 because each chunk carries more information. This is where chunking strategy and top_k interact — if you switch from semantic to fixed-size chunking with smaller chunks, you may need to increase top_k.

**Question complexity.** "What is the filing date?" needs one chunk. "Compare the settlement terms across all three complaints" might need 8-10.

**Reranker presence.** With a reranker and 4x over-fetch, the pipeline evaluates 20 candidates and returns the 5 best. The reranker ensures those 5 are the right ones, so top_k can stay low even with a large corpus.

This pipeline uses top_k=5 as a default. With the reranker's 4x over-fetch, 20 candidates get evaluated and the 5 best are returned. Test top_k values of 3, 5, and 8 against your eval suite with each retrieval strategy — the delta will tell you whether your retrieval is strong enough at low top_k or if you're leaving relevant context on the floor.

---

## The Comparison Matrix

Here's a summary of what to test and what each variant optimizes for:

| Axis | Variant A | Variant B | Trade-off |
|:-----|:----------|:----------|:----------|
| Chunking | Fixed-size (1000/200) | Semantic (paragraphs) | Recall vs. coherence |
| PDF Parsing | PyMuPDF (local) | Reducto (cloud API) | Cost/speed vs. layout quality |
| Retrieval | Cosine similarity | Hybrid (cosine+BM25+RRF) | Simplicity vs. recall |
| Reranking | None | Cohere API | Speed/cost vs. precision |
| Reranking | None | Local cross-encoder | Speed vs. precision |
| Embedding Model | text-embedding-3-small | text-embedding-3-large | Cost/speed vs. fidelity |
| top_k | 3 | 5 - 8 | Focus vs. coverage |

You don't need to test every combination. Start with retrieval strategy (cosine vs. hybrid) — that's usually the highest-impact change. Then add reranking to your best retrieval variant. Then tune chunking, embedding model, and top_k.

---

## The Full Specification Prompt

If you want to build the complete pipeline with all strategies toggleable in a single pass, here's the expanded prompt. It produces the baseline with every variant wired behind environment variables, so you can switch strategies by changing env vars and re-running your eval suite without rebuilding anything.

```
I want to build a RAG pipeline for querying PDF documents. Use Graphite (gt) to
stack each feature as a separate PR. Use `gt create` for each PR and
`gt submit --no-interactive` when the stack is complete.

## Tech Stack
- Backend: Python FastAPI
- Database: PostgreSQL with pgvector extension (docker-compose for local dev)
- PDF Parsing: PyMuPDF (default) or Reducto cloud API (PDF_PARSER env var)
- Embeddings: OpenAI text-embedding-3-small (default) or text-embedding-3-large
  (EMBEDDING_MODEL env var, dimension follows model choice)
- Similarity: pgvector cosine distance operator (<=>), top_k ranked results
- LLM: Anthropic Claude for answer generation
- Frontend: React with TanStack Router, TailwindCSS

## PR Stack

### PR 1: Infrastructure + Data Models
- docker-compose.yaml with pgvector/pgvector:pg16
- Database migrations using golang-migrate format:
  - `documents` table (id, file_hash for dedup, file_path, metadata JSONB,
    status, file_size)
  - `chunks` table (id, document_id FK, content, chunk_type, page_number,
    position, embedding vector(1536), bbox JSONB, search_vector tsvector
    generated always as to_tsvector('english', content) stored, GIN index)
- PgVectorStore class with connection management, migrations runner,
  CRUD operations, similarity_search, _bm25_search, and hybrid_search methods
- Health and readiness endpoints

### PR 2: Ingestion Pipeline
- PyMuPDF PDF parser with font-size classification, OCR fallback for scanned
  pages, garbage text detection. ReductoParser as alternative (PDF_PARSER env var)
- Both chunking strategies: semantic_chunking_by_paragraphs (default) and
  fixed_size_chunking. CHUNKING_STRATEGY env var to toggle
- OpenAI embedding generation with token-based batching and retry logic.
  EMBEDDING_MODEL env var to toggle between text-embedding-3-small (1536 dims)
  and text-embedding-3-large (3072 dims)
- Ingestion pipeline: validate -> hash for dedup -> parse -> chunk -> embed -> store
- Batch ingestion with ThreadPoolExecutor (per-thread DB connections)

### PR 3: Retrieval + Query API
- RAGRetriever with hybrid_search (default) or cosine-only (RETRIEVAL_STRATEGY env var)
- Abstract Reranker base class. Cohere backend (rerank-v3.5, optional dep).
  Local cross-encoder backend (ms-marco-MiniLM-L-6-v2, optional dep).
  RERANKER env var to toggle
- Over-fetch 4x when reranker present, pass through reranker, return top_k
- Claude-powered answer generation with source references
- POST /api/v1/rag/query, GET /api/v1/documents, GET /api/v1/documents/{id}/file

### PR 4: Frontend
- TanStack Router with file-based routing
- Split-pane layout: chat panel (left) + evidence panel (right)
- Document upload (single file + folder upload via webkitdirectory)
- Chat interface with query input
- Evidence panel with react-pdf viewer and bounding box highlights

Environment variables for A/B testing:
- PDF_PARSER: "pymupdf" (default) or "reducto"
- CHUNKING_STRATEGY: "semantic" (default) or "fixed"
- EMBEDDING_MODEL: "text-embedding-3-small" (default) or "text-embedding-3-large"
- RETRIEVAL_STRATEGY: "hybrid" (default) or "cosine"
- RERANKER: "cohere", "cross-encoder", or empty (default: none)
```

Ingest your test corpus once per configuration that changes chunking, parsing, or embedding model (those affect stored chunks). For retrieval and reranking changes, the same stored chunks work — just toggle the env var and re-run your eval queries.

---

## Wrapping Up

The value isn't in any single strategy — it's in being able to test them against your actual documents and queries. Every RAG pipeline is different because every corpus is different. Legal PDFs with precise terminology benefit more from BM25 than a corpus of conversational support tickets. A small collection of well-structured documents might not need reranking at all. You won't know until you measure.

The workflow — CLAUDE.md for consistency, one prompt per variant, Graphite for clean PRs — exists to make testing cheap. When building a variant takes an hour instead of a day, you actually do it instead of shipping your first guess.

If you're building your first RAG system and this feels like a lot of moving parts: start with the baseline. Get cosine similarity working. Then add one variant at a time and watch how your eval numbers change. The worked example above shows the mechanics — the intuition comes from seeing it on your own data.

<a href="https://github.com/rasha-hantash/pdf-classaction-rag" target="_blank">Full repo here.</a>
