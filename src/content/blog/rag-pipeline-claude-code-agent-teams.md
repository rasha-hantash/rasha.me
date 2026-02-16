---
title: "I Built a Full RAG Pipeline in a Day Using Claude Code Agent Teams and Stacked PRs"
pubDate: 2026-02-16
description: "How CLAUDE.md-guided agents, Graphite's MCP, and one well-crafted prompt turned a blank repo into a document Q&A system with hybrid search, reranking, and PDF evidence highlighting."
tags: ["rag", "claude-code", "ai-agents", "graphite"]
draft: false
---

Six stacked PRs. Each one adds a single capability. By the end, a blank repo becomes a working RAG system: PDF upload, semantic chunking, pgvector search, BM25 hybrid retrieval with reciprocal rank fusion, optional reranking via Cohere or a local cross-encoder, Claude-powered answers, and a React frontend that highlights the exact bounding boxes in the source PDF where each answer came from.

But the interesting part isn't the RAG pipeline — you've built one before, or you know how they work. The interesting part is the workflow. One prompt to a Claude Code agent team. Graphite stacks each feature as a reviewable PR. You review and merge.

[Here's the repo](https://github.com/yourusername/pdf-classaction-rag) if you want to skip ahead.

---

## The Prompt

Claude Code has Graphite's MCP server integrated, but you still need to explicitly tell it to use Graphite for stacking PRs. The prompt below is what I actually gave it. It's intentionally high-level — specific on the key technical decisions (pgvector, Reducto, RRF with k=60, Cohere reranking) but loose on implementation details. That's what CLAUDE.md handles.

Will it work perfectly in one shot? Probably not. You'll likely do 1-2 debugging iterations. But you'll have the full skeleton of a RAG pipeline with clean, stacked PRs in under an hour.

```
Build a RAG pipeline for querying PDF documents. Use Graphite (gt) to stack
each feature as a separate PR. Use `gt create` for each PR and
`gt submit --no-interactive` when the stack is complete.

Tech: Python FastAPI, PostgreSQL + pgvector, Reducto for PDF parsing,
OpenAI text-embedding-3-small for embeddings,
Claude for answer generation, React + TanStack Router frontend.

PR 1: Infrastructure + data models — docker-compose with pgvector,
      database migrations (documents + chunks tables with vector(1536)),
      PgVectorStore class with similarity search
PR 2: Ingestion pipeline — Reducto PDF parsing, semantic chunking,
      embedding generation, batch upload with ThreadPoolExecutor
PR 3: Retrieval + API — similarity search, relevance filtering,
      Claude-powered answer generation, FastAPI endpoints
PR 4: Frontend — file and folder upload, chat interface, evidence panel
      with react-pdf and bounding box highlights
PR 5: BM25 hybrid search — add tsvector column to chunks, BM25 full-text
      search, reciprocal rank fusion (k=60) combining vector + keyword results
PR 6: Reranker — abstract Reranker interface, Cohere API backend,
      local cross-encoder backend, 4x over-fetch when reranker is configured
```

Each `gt create` produces a branch that tracks its parent. `gt submit` pushes the entire stack. No manual branch management, no rebasing. The reviewer sees six focused PRs instead of one massive diff.

For debugging iterations, you're working within the same Graphite stack — `gt modify` amends the current PR and rebases everything above it.

### The full specification prompt

If you want to maximize the chances of this working in one shot, here's the expanded version. Same structure, but with explicit implementation details that reduce ambiguity for the agent.

```
I want to build a RAG pipeline for querying PDF documents. Use Graphite (gt) to
stack each feature as a separate PR. Use `gt create` for each PR and
`gt submit --no-interactive` when the stack is complete.

## Tech Stack
- Backend: Python FastAPI
- Database: PostgreSQL with pgvector extension (docker-compose for local dev)
- PDF Parsing: Reducto cloud API (REDUCTO_API_KEY env var)
- Embeddings: OpenAI text-embedding-3-small (1536 dimensions)
- Similarity: pgvector cosine distance operator (<=>), top_k ranked results
- LLM: Anthropic Claude for answer generation
- Frontend: React with TanStack Router, TailwindCSS

## PR Stack (each PR builds on the previous)

### PR 1: Infrastructure + Data Models
- docker-compose.yaml with pgvector/pgvector:pg16
- Database migrations using golang-migrate format:
  - `documents` table (id, file_hash for dedup, file_path, metadata JSONB)
  - `chunks` table (id, document_id FK, content, chunk_type, page_number,
    position, embedding vector(1536), bbox JSONB)
- PgVectorStore class with connection management, migrations runner,
  CRUD operations, and similarity_search method
- Health and readiness endpoints

### PR 2: Ingestion Pipeline
- PDF parsing with Reducto cloud API
- Semantic chunking (split by paragraph boundaries, merge small paragraphs,
  fixed-size fallback for large blocks)
- OpenAI embedding generation with token-based batching and retry logic
- Ingestion pipeline: validate -> hash for dedup -> parse -> chunk -> embed
  -> store
- Batch ingestion with ThreadPoolExecutor (per-thread DB connections)
- POST /api/v1/rag/ingest and POST /api/v1/rag/ingest/batch endpoints

### PR 3: Retrieval + Query API
- RAG retriever: embed query -> similarity search -> return top_k ranked
  results -> build context -> Claude generates answer with source references
- POST /api/v1/rag/query endpoint
- GET /api/v1/documents endpoint (list with chunk counts)
- GET /api/v1/documents/{id}/file endpoint (serve original PDF)

### PR 4: Frontend
- TanStack Router with file-based routing
- Split-pane layout: chat panel (left) + evidence panel (right)
- Document upload (single file + folder upload via webkitdirectory)
- Chat interface with query input
- Evidence panel with react-pdf viewer and bounding box highlights
- API client with typed fetch wrappers

### PR 5: BM25 Hybrid Search
- Add a `search_vector` tsvector column to chunks, generated always from
  content using to_tsvector('english', content), with a GIN index
- BM25 full-text search method using plainto_tsquery and ts_rank
- Hybrid search method: over-fetch from both vector search and BM25
  (fetch_k = top_k * 3), combine with Reciprocal Rank Fusion (k=60),
  deduplicate on chunk_id, return top_k
- Zero ingestion changes — tsvector column is auto-populated by PostgreSQL
- Update retriever to use hybrid_search instead of similarity_search

### PR 6: Reranker Interface
- Abstract Reranker base class with a rerank(query, results, top_k) method
- Cohere backend: uses rerank-v3.5 API, maps relevance scores back to
  SearchResult objects. Requires COHERE_API_KEY env var
- Local cross-encoder backend: uses sentence-transformers
  cross-encoder/ms-marco-MiniLM-L-6-v2 model, scores (query, passage) pairs
  locally. No API key needed
- Both backends are optional dependencies (rerank-cohere, rerank-local extras
  in pyproject.toml) with try/except import guards
- Retriever over-fetches 4x (fetch_k = top_k * 4) when a reranker is
  configured, passes candidates through reranker before returning top_k
- Environment-based configuration: RERANKER=cohere or RERANKER=cross-encoder
```

---

## Why You Need More Than Vector Search

Here's what I learned building this: cosine similarity alone isn't enough. It's a great starting point — you embed your query, find the nearest chunks, and you're done. But it has blind spots.

Vector search understands meaning. If your PDF says "securities fraud class action" and you ask about "legal violations in the stock market," embeddings will find the match because the concepts are semantically close. But if you search for the exact phrase "securities fraud class action" — the literal words that appear in the document — pure vector search can actually rank a semantically-similar-but-not-exact passage higher than the one containing the exact terms.

That's where BM25 comes in. It's keyword matching — the same algorithm that powered search engines before embeddings existed. It's fast, it's well-understood, and it catches what vector search misses: exact terminology, proper nouns, case numbers, legal citations.

The hybrid approach (PR 5) runs both searches and combines them with Reciprocal Rank Fusion. Each search produces a ranked list. RRF converts ranks to scores using `1 / (k + rank)` with k=60, then sums across both lists. A chunk that ranks highly in both vector *and* keyword search gets a higher combined score than one that only appears in one. The implementation adds a single auto-generated tsvector column to the chunks table — zero changes to the ingestion pipeline.

You'll notice the pipeline doesn't use a hard cosine similarity threshold (e.g., "only return results with score >= 0.3"). That's intentional. A fixed cutoff is fragile — the "right" number depends on your embedding model, your domain, and your chunk sizes. With a small corpus, a 0.3 threshold might return zero results for a perfectly valid question. With a large corpus of similar documents, hundreds of mediocre chunks might clear that bar. Instead, the pipeline relies on top_k ranking combined with RRF fusion and reranking to surface the best results. RRF naturally suppresses low-quality candidates — a chunk that only appears in one search method at a low rank gets a negligible fused score. And the reranker is a far more sophisticated quality gate than any static number, because it evaluates actual query-passage relevance with a model trained for that task.

### Why top_k ranking beats a cosine threshold — a worked example

Let's make this concrete. Imagine a small corpus of 10 chunks and the query: **"How do I handle authentication token refresh in microservices?"**

**With a cosine similarity threshold (>= 0.3),** the embedding model scores every chunk and returns anything above the cutoff:

| Chunk | Content | Cosine | Pass? |
|-------|---------|--------|-------|
| C1 | JWT refresh token rotation pattern | 0.82 | Yes |
| C2 | OAuth2 token lifecycle in distributed systems | 0.71 | Yes |
| C3 | Microservice-to-microservice auth with mTLS | 0.58 | Yes |
| C10 | gRPC interceptors for auth propagation | 0.44 | Yes |
| C4 | Session management in monoliths | 0.35 | Yes |
| C5 | API rate limiting strategies | 0.31 | Yes |
| C8 | Token bucket algorithm for throttling | 0.29 | No |
| C7 | Kubernetes service mesh overview | 0.28 | No |
| C6 | Database connection pooling | 0.22 | No |
| C9 | Circuit breaker pattern for resilience | 0.18 | No |

Six chunks go to the LLM. C4 (session management in monoliths) and C5 (API rate limiting) barely cleared the bar — they're noise that dilutes the context window. Meanwhile C8 (token bucket) got excluded at 0.29, but it's no less relevant than C5 at 0.31. The cutoff is arbitrary. Change embedding models and these numbers shift entirely. Grow the corpus and hundreds of mediocre chunks might clear 0.3.

**With top_k + RRF + reranking,** the same query produces a different pipeline:

**Step 1 — Vector search (top 5 by rank):** Same cosine math, but you take the top 5 instead of applying a threshold. No magic number to calibrate.

| Rank | Chunk | Cosine |
|------|-------|--------|
| 1 | C1 — JWT refresh token rotation | 0.82 |
| 2 | C2 — OAuth2 token lifecycle | 0.71 |
| 3 | C3 — Microservice auth with mTLS | 0.58 |
| 4 | C10 — gRPC interceptors for auth | 0.44 |
| 5 | C4 — Session management in monoliths | 0.35 |

**Step 2 — BM25 keyword search (top 5 by rank):** Full-text search on the tsvector column catches lexical matches the embedding missed.

| Rank | Chunk | BM25 |
|------|-------|------|
| 1 | C1 — JWT refresh token rotation | 12.4 |
| 2 | C10 — gRPC interceptors for auth | 9.8 |
| 3 | C3 — Microservice auth with mTLS | 7.2 |
| 4 | C8 — Token bucket algorithm | 6.1 |
| 5 | C2 — OAuth2 token lifecycle | 5.3 |

C8 shows up because it literally contains the word "token." BM25 catches it; the embedding model didn't rank it highly because semantically "token bucket for throttling" is far from "authentication token refresh."

**Step 3 — Reciprocal Rank Fusion (k=60).** RRF converts each rank to a score using `1 / (k + rank)` and sums across both lists:

| Chunk | Vector Rank | Keyword Rank | RRF Score |
|-------|------------|-------------|-----------|
| C1 | 1 | 1 | 1/61 + 1/61 = **0.0328** |
| C10 | 4 | 2 | 1/64 + 1/62 = **0.0318** |
| C3 | 3 | 3 | 1/63 + 1/63 = **0.0317** |
| C2 | 2 | 5 | 1/62 + 1/65 = **0.0315** |
| C8 | — | 4 | 0 + 1/64 = **0.0156** |
| C4 | 5 | — | 1/65 + 0 = **0.0154** |

C4 and C8 are naturally suppressed — they only appeared in one list, so they get roughly half the RRF score. No threshold needed. C10 jumped up: it ranked 4th in vector but 2nd in keyword, and RRF recognized it's strong in both modalities.

**Step 4 — Reranker.** A cross-encoder model reads the actual query and each passage, producing a relevance score that understands meaning, not just geometry or term frequency:

| Chunk | RRF Rank | Reranker Score | Final Rank |
|-------|---------|---------------|-----------|
| C1 — JWT refresh token rotation | 1 | 0.94 | **1** |
| C2 — OAuth2 token lifecycle in distributed systems | 4 | 0.88 | **2** |
| C10 — gRPC interceptors for auth propagation | 2 | 0.72 | **3** |
| C3 — Microservice auth with mTLS | 3 | 0.65 | **4** |
| C8 — Token bucket algorithm | 5 | 0.08 | **5** |
| C4 — Session management in monoliths | 6 | 0.12 | **6** |

C2 jumped from 4th to 2nd — the reranker understood that "OAuth2 token lifecycle in distributed systems" is deeply relevant to the query, even though RRF had it slightly lower. C8 cratered to 0.08 — the reranker read the passage and knew "token bucket for throttling" has nothing to do with auth token refresh. BM25 was fooled by the word "token"; the reranker wasn't.

**Final result:** C1, C2, C10, C3 go to the LLM — four high-quality chunks instead of six with noise mixed in.

| | Cosine >= 0.3 | Top-K + RRF + Rerank |
|---|---|---|
| Results sent to LLM | C1, C2, C3, C4, C5, C10 (6 chunks) | C1, C2, C10, C3 (4 chunks) |
| Noise included | C4 (monoliths), C5 (rate limiting) | Neither |
| Quality gate | Static number (0.3) | Trained relevance model |
| Adapts to corpus size | No — needs manual tuning | Yes — top_k is relative |
| Adapts to embedding model | No — scores shift per model | Yes — only ranks matter |
| Catches lexical matches | No — pure semantic | Yes — BM25 finds keyword hits |

### Why top_k=5 (and how to think about sizing it)

There's no universal right answer for top_k — it depends on what's downstream. The real question is: how many chunks does your LLM need to answer the question well?

Too few (top_k=2) and you risk missing a relevant passage entirely. The answer might span two chunks, or the best evidence might be ranked 3rd by one search method. Too many (top_k=50) and you're stuffing the context window with marginally relevant text, which dilutes the signal and increases latency and token cost.

For most RAG systems, **top_k between 3 and 10 is the practical range.** Where you land within that depends on a few factors:

- **Corpus size.** A handful of PDFs (say, 5-10 documents, a few hundred chunks) — top_k of 3-5 is usually enough. The relevant information isn't spread across many chunks, and a low top_k keeps responses tight. Hundreds of documents with thousands of chunks — you might bump to 8-10, because the answer is more likely distributed across multiple sources.
- **Chunk size.** If you're chunking at ~200 tokens (small, granular chunks), you'll need a higher top_k to cover enough context — maybe 8-10. If your chunks are ~500-800 tokens (paragraph-level), 3-5 often suffices because each chunk carries more information.
- **Question complexity.** "What is the filing date?" needs one chunk. "Compare the settlement terms across all three complaints" might need 8-10. If your use case involves multi-document synthesis, lean higher.
- **Reranker presence.** When a reranker is configured, the pipeline over-fetches (4x top_k) to give the reranker a large candidate pool, then cuts back to top_k after reranking. So the final top_k can stay low even with a large corpus — the reranker ensures those few results are the right ones.

This pipeline uses top_k=5 as a default because it targets single-document or small-collection Q&A over legal PDFs — typically a few hundred chunks where most questions can be answered from 3-5 passages. With the 4x over-fetch and reranker, the system evaluates 20 candidates and returns the 5 best. For a larger deployment with thousands of documents, you'd likely bump this to 8-10 and let the reranker do the heavy lifting.

### Why k=60 and not some other number

The `k` in RRF's `1/(k + rank)` controls how much rank position differences matter when fusing two lists.

With a **small k (say k=1):** Rank 1 gets `1/2 = 0.50`, rank 2 gets `1/3 = 0.33`, rank 5 gets `1/6 = 0.17`. Being #1 versus #2 is a massive gap. The top-ranked result from each search dominates.

With **k=60:** Rank 1 gets `1/61 = 0.0164`, rank 2 gets `1/62 = 0.0161`, rank 5 gets `1/65 = 0.0154`. The scores are compressed — being #1 versus #5 barely matters.

Why does compression help? Because you're fusing two different ranking systems that don't agree on what "rank 1" means. Vector search and BM25 measure fundamentally different things. A chunk that's rank 1 in vector search and rank 5 in BM25 might genuinely be the best overall result. With a small k, the BM25 rank 5 contributes almost nothing. With k=60, it still contributes meaningfully. The high k says: *appearing in both lists matters more than your exact position in either.*

60 comes from the [original RRF paper (Cormack et al., 2009)](https://dl.acm.org/doi/10.1145/1571941.1572114). It works well empirically across a wide range of retrieval tasks. You can tune it, but most production implementations — including Elasticsearch's RRF implementation — just use 60.

That's what the reranker fixes (PR 6). Instead of relying on the geometric similarity of embeddings or the term frequency of BM25, a reranker takes the actual query and each candidate passage, feeds them through a model trained specifically for relevance ranking, and re-scores them.

The pipeline with reranking looks like this:

```
Query → Embed → Hybrid Search (vector + BM25, over-fetch 4x)
      → Reciprocal Rank Fusion → Rerank (Cohere or cross-encoder)
      → Top K → Build Context → Claude → Answer + Sources
```

Two reranker backends give you flexibility. Cohere's API is the most accurate — you send candidates, you get relevance scores, done. But it adds 200-400ms of latency and costs per call. The local cross-encoder (`ms-marco-MiniLM-L-6-v2`) runs on your machine, adds ~50-150ms with a GPU, and costs nothing after the initial model download. Both are optional — install `pip install .[rerank-cohere]` or `pip install .[rerank-local]` depending on what you need, or skip the reranker entirely for the fastest path.

The retriever handles this transparently. When a reranker is configured, it over-fetches 4x the candidates to give the reranker a good pool to work with. When it's not, it fetches exactly top_k and returns. Same interface, same API endpoint, just better results when you opt in.

---

## CLAUDE.md — Teaching Your Agents How to Code Like You

This is the part most people skip, and it's the part that matters most.

CLAUDE.md is not a README. It's codified engineering standards that every agent reads before writing a single line of code. Transaction rollback patterns. Batch inserts with `execute_values`. Resource cleanup. Structured logging. Frontend directory conventions. When you spin up agent teams — one working on the backend, one on the frontend — they both read CLAUDE.md. Both agents produce code that follows the same patterns without you copy-pasting instructions into each prompt.

Here's an example from the CLAUDE.md in this project — the database transaction pattern:

```python
# From CLAUDE.md — every agent follows this
def insert_something(self, data):
    try:
        with self.conn.cursor() as cur:
            cur.execute("INSERT ...", (data,))
        self.conn.commit()
    except Exception:
        self.conn.rollback()
        raise
```

And here's the real code that the agent produced (simplified from `database.py`):

```python
def insert_document_with_chunks(self, file_hash, file_path, chunks, metadata=None):
    try:
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "INSERT INTO documents (...) VALUES (%s, %s, %s) RETURNING *",
                (file_hash, file_path, Json(metadata or {}))
            )
            doc = cur.fetchone()
            if chunks:
                values = [
                    (str(doc["id"]), c.content, c.chunk_type, ...)
                    for c in chunks
                ]
                execute_values(
                    cur,
                    "INSERT INTO chunks (...) VALUES %s RETURNING *",
                    values,
                    fetch=True,
                )
        self.conn.commit()
        return doc, chunks
    except Exception:
        self.conn.rollback()
        raise
```

The real code follows the CLAUDE.md pattern exactly — `try`/`except` with rollback, `execute_values` for batch insert, `RealDictCursor`. The agent didn't need to be told twice. You define the pattern once in CLAUDE.md, and it propagates through every file the agents touch.

This is the leverage. The prompt tells agents *what* to build. CLAUDE.md tells them *how* to build it.

---

## What It Produced

The pipeline does what you'd expect: Reducto parses PDFs, OpenAI embeds the chunks into pgvector, and Claude generates answers with source references. The entire persistence layer is two tables:

```sql
-- Two tables. One vector column. One tsvector column. That's the entire persistence layer.
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
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

Ingest takes a PDF through validate -> hash for dedup -> Reducto parse -> semantic chunk -> embed -> store. The `search_vector` column populates itself — PostgreSQL generates it from the content automatically, so the ingestion pipeline doesn't change at all when you add BM25.

Query embeds the question, runs hybrid search (vector cosine similarity + BM25 full-text, combined via RRF), optionally reranks through Cohere or a local cross-encoder, and hands the top results to Claude along with the question. The frontend is a split-pane React app — chat on the left, evidence on the right with react-pdf rendering the source document and bounding box highlights on the exact passages Claude cited.

Six PRs, six capabilities, each one reviewable in isolation.

---

## Wrapping Up

The workflow is: CLAUDE.md defines your conventions. One prompt to an agent team with Graphite stacking produces focused, reviewable PRs. You review, iterate where needed, and merge.

If you're early in your career and RAG feels like a lot — it is a lot. There are real decisions in here around chunking strategy, hybrid search fusion, whether reranking is worth the latency. This workflow doesn't skip those decisions. It gives you a working implementation to study, review, and iterate on instead of starting from a blank file.

This stacking model works well for building one feature end-to-end. When you're juggling multiple independent features in parallel, [Conductor](https://conductor.build/) lets you spin up parallel Claude Code instances in isolated git worktrees — each agent team works on a separate feature without stepping on each other.

[Full repo here.](https://github.com/yourusername/pdf-classaction-rag)
