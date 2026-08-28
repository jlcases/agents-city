---
name: measurement
description: Before touching anything that affects measurement — analytics events, the tag manager, the data layer, ad pixels, consent, URLs and slugs, warehouse schemas, transformation models, ETL jobs. Use it too when answering what is being collected, whether a series is split, or what a query is going to cost.
---

# Measurement

The property belongs to whoever answers for data (in the demo, `bruno/devops`
with `tambien: [data]`). The full domain is in `roles/data.md`.

## The only thing you have to understand

**What you do not collect, you do not recover.** An interface regression is
visible and gets fixed. An event that stopped firing shows up in next month's
report, and that month does not exist: there is no backfill.

Everything else follows from that, including the rule that here **when in doubt
you notify** — the opposite of every other property.

## The silent damage, which is the dangerous kind

Three changes **break nothing** and still do damage. None errors, none raises an
alert, and all three surface weeks later:

1. **Changing a URL or a slug.** The data keeps arriving, but the comparison with
   last year stops meaning the same thing: the series is split. URLs are usually
   a product decision rather than an infrastructure one, and there changes **get
   agreed, not deployed**.
2. **Renaming an event.** Same: two short series where there was one long one.
3. **Touching consent.** Whoever owns the consent tool decides what can be
   measured across the whole product. A change there can stop collection without
   anything failing — which is why it belongs to whoever answers for data and not
   to whoever installs it.

## Before you touch anything

- **Does that event already exist under another name?** Duplicating an event is
  worse than not having it: it splits the analysis in two and nobody knows which
  is right.
- **Which report depends on this column?** Before changing a schema or dropping a
  field, find who consumes it: a transformation model, a dashboard, a campaign.
- **What consent does it fire under?** A pixel firing without consent is not a
  measurement problem, it is a different kind of problem.
- **What does it cost?** In a warehouse, a new query over a large table is cost,
  not latency. Look at the volume before leaving it in a recurring job.

## When answering a measurement notice

With the data in front of you, not from memory. "I think that is still being
collected" is not an answer: check whether the event arrives, since when, and at
what volume. And if the answer is that the series was already split before, say
that too — discarding a false positive is half the value.
