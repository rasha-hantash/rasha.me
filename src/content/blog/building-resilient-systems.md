---
title: "Building Resilient Systems at Scale"
pubDate: 2025-12-15
description: "Lessons learned from scaling a legal-tech platform from prototype to processing millions in claims."
tags: ["go", "infrastructure", "startups"]
draft: false
---

## The Challenge

When we started ClaimClam, our entire backend was an Airtable. It worked for the first hundred users, but we knew it wouldn't hold. The question wasn't *if* we needed to migrate—it was *how fast* we could do it without dropping a single claim.

## Double-Entry Ledger: Trust Through Accounting

The payment system was the most critical piece. When you're processing millions of dollars in class-action settlements, every cent must be accounted for. We implemented a double-entry ledger in Go:

```go
type LedgerEntry struct {
    ID          uuid.UUID
    DebitAcct   string
    CreditAcct  string
    Amount      int64  // cents
    Currency    string
    Reference   string
    CreatedAt   time.Time
}

func (s *Service) Transfer(ctx context.Context, from, to string, amount int64) error {
    tx, err := s.db.BeginTx(ctx, nil)
    if err != nil {
        return fmt.Errorf("begin tx: %w", err)
    }
    defer tx.Rollback()

    entry := LedgerEntry{
        ID:         uuid.New(),
        DebitAcct:  from,
        CreditAcct: to,
        Amount:     amount,
        Currency:   "USD",
        CreatedAt:  time.Now().UTC(),
    }

    if err := s.insertEntry(ctx, tx, entry); err != nil {
        return fmt.Errorf("insert entry: %w", err)
    }

    return tx.Commit()
}
```

Every transaction creates two entries—a debit and a credit. The sum of all entries must always be zero. This invariant caught bugs before they became financial errors.

## From Airtable to Aurora

The migration path looked like this:

1. **Dual-write phase**: New records go to both Airtable and Aurora
2. **Backfill**: Migrate all historical records with checksums
3. **Validation**: Run parallel reads and compare results for a week
4. **Cutover**: Switch reads to Aurora, keep Airtable as backup
5. **Cleanup**: Decommission Airtable sync after 30 days

The key insight: never do a big-bang migration. Every step should be independently reversible.

## Lessons Learned

- **Start with the invariants.** Before writing any code, define what must always be true. For us: every dollar in must equal every dollar out.
- **Instrument everything.** We logged every state transition. When something went wrong at 2 AM, the logs told the whole story.
- **Design for the rollback.** Every deployment should be reversible. If it can't be rolled back, it needs more planning.
- **Boring technology wins.** PostgreSQL, Go, and Terraform aren't exciting. They're reliable. That's what matters when you're handling other people's money.

## What's Next

I'm now exploring distributed systems patterns—specifically fan-out messaging with RabbitMQ and event sourcing. The principles are the same: make the happy path simple, make failures visible, and always have a way back.
