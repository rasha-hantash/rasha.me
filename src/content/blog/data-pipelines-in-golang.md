---
title: "Part 1: Data Pipelines in Golang"
pubDate: 2024-11-10
description: "Build a tiny, production-style pipeline in Go that crawls a public web page, transforms the result, and uploads it somewhere useful — all in ~150 lines of code."
tags: ["go", "data-pipelines", "etl"]
draft: false
---

## TL;DR

We'll build a tiny, production-style pipeline in Go that crawls a public web page, transforms the result, and uploads it somewhere useful — all in ~150 lines of code.

The full repo lives here: <a href="https://github.com/rasha-hantash/gdoc-crawler" target="_blank">https://github.com/rasha-hantash/gdoc-crawler</a>

## Why another "pipeline" tutorial?

Real-world ETL jobs rarely fit into one tidy main.go; they're a chain of steps that comprise of Extracting, Transforming, or Loading.

That's exactly what my larger project (the one whose source you're reading) does for Google Docs, but today we'll shrink the idea down so you can grok the pattern in an evening. PS: everything I know about data pipelines comes from the O'Reilly Data Pipeline's Pocket Reference Book that I thrifted for $5 in Brooklyn, NYC a few years back.

## 1 — Project scaffold

```bash
go mod init example.com/pipeline-demo
touch main.go pipeline.go steps.go
```

We'll end up with three files:

| file | responsibility |
|------|---------------|
| steps.go | defines the Step interface & a couple of concrete steps |
| pipeline.go | orchestration: run steps in order, pick up from a failed step |
| main.go | CLI flags, logging, wiring |

## 2 — The contract every step obeys

```go
// steps.go
package main

import "context"

type Step interface {
    Name() string
    Run(context.Context) error
}
```

That's it. Tiny, testable, and endlessly reusable.

### Example Step #1: Crawl

```go
package main

import (
    "context"
    "io"
    "net/http"
    "os"
)

type Crawler struct{ url, out string }

func (c Crawler) Name() string { return "crawler" }

func (c Crawler) Run(ctx context.Context) error {
    req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return err }
    defer resp.Body.Close()

    f, err := os.Create(c.out)
    if err != nil { return err }
    defer f.Close()

    _, err = io.Copy(f, resp.Body)
    return err
}
```

What we left out for clarity: timeouts, retries, metrics for successful and failed uploads, etc. (Add them later — your future self will thank you.)

### Example Step #2: Transform

```go
type Transformer struct{ in, out string }

func (t Transformer) Name() string { return "transformer" }

func (t Transformer) Run(_ context.Context) error {
    // naive "transformation": wrap the raw HTML in <article>
    raw, err := os.ReadFile(t.in)
    if err != nil { return err }

    article := []byte("<article>\n" + string(raw) + "\n</article>")
    return os.WriteFile(t.out, article, 0644)
}
```

### Example Step #3: Upload

```go
type Uploader struct{ in string }

func (u Uploader) Name() string { return "uploader" }

func (u Uploader) Run(_ context.Context) error {
    // pretend this pushes to S3, Drive, etc.
    log.Printf("would upload %s (size=%d bytes)\n",
        u.in, must(os.Stat(u.in)).Size())
    return nil
}
```

## 3 — The Pipeline runner

```go
// pipeline.go
package main

import (
    "context"
    "fmt"
    "log"
    "time"
)

type Pipeline struct{ steps []Step }

func NewPipeline(s ...Step) *Pipeline { return &Pipeline{steps: s} }

// RunFrom lets you restart from any step — handy after a crash.
func (p *Pipeline) RunFrom(ctx context.Context, start int) error {
    if start < 0 || start >= len(p.steps) {
        return fmt.Errorf("start index %d out of range", start)
    }

    for i := start; i < len(p.steps); i++ {
        st := p.steps[i]
        t0 := time.Now()
        log.Printf("  %s (%d/%d)", st.Name(), i+1, len(p.steps))

        if err := st.Run(ctx); err != nil {
            return fmt.Errorf("%s failed: %w", st.Name(), err)
        }
        log.Printf("  %s done in %s\n", st.Name(), time.Since(t0))
    }
    return nil
}

// FindIndex helps the `-retry` flag jump to a step by name.
func (p *Pipeline) FindIndex(name string) int {
    for i, s := range p.steps {
        if s.Name() == name {
            return i
        }
    }
    return -1
}
```

## 4 — Wiring it all together

```go
// main.go
package main

import (
    "context"
    "flag"
    "log"
)

func main() {
    var (
        url   = flag.String("url", "", "URL to fetch")
        out   = flag.String("out", "page.html", "downloaded file")
        retry = flag.String("retry", "", "step to restart from (optional)")
    )
    flag.Parse()
    if *url == "" { log.Fatal("-url is required") }

    p := NewPipeline(
        Crawler{*url, *out},
        Transformer{*out, "article.html"},
        Uploader{"article.html"},
    )

    start := 0
    if *retry != "" {
        start = p.FindIndex(*retry)
        if start == -1 { log.Fatalf("unknown step %q", *retry) }
    }

    if err := p.RunFrom(context.Background(), start); err != nil {
        log.Fatal(err)
    }
}
```

Run it:

```bash
go run . -url https://example.com
```

Or retry just the upload after you fixed credentials:

```bash
go run . -url https://example.com -retry "uploader"
```

## 5 — What you've learned (and what to add next)

| concept | in this demo | next-level idea |
|---------|-------------|-----------------|
| Structured logging | log.Printf | log/slog with JSON output (see my full repo) |
| Retries & back-off | none | wrap HTTP + Drive calls with exponential back-off |
| Parallelism | none | dedicate a goroutine per stage communicating via channels so each step can start as soon as the previous step begins to output data |
| Data Orchestration | none | If you want your ETL to have some real muscles added to it I recommend using Temporal |
| Observability | print timings | expose Prometheus metrics per step |

## 6 — Wrapping up

A pipeline is just a sequence of tiny, well-behaved steps. By enforcing one micro-interface (`Run(ctx)`), you unlock:

**Swap-ability** – mix & match new steps without changing plumbing

**Resilience** – retry exactly where you left off

**Testability** – unit-test each step in isolation

When you're ready for the real thing — OAuth, Google Drive uploads, link-rewriting magic — dive into the <a href="https://github.com/rasha-hantash/gdoc-crawler" target="_blank">full source</a> linked at the top. For the next level data orchestration look to using Temporal.

Happy piping!
