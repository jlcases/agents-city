---
name: design-review
description: How to review a change from product and design without reading the code — what to look at in a PR, which states are always forgotten, how to ask for a screenshot, and how to answer a UX notice. Use it when an interface notice arrives, when reviewing a PR from design, or when deciding whether something steps outside the design system.
---

# Reviewing from design

For whoever holds the design seats. The domain is in `roles/product-design.md`;
the split by unit, in `parcels.yml` of the data repo.

## The real problem

A PR is read in code and you do not review code. But the question you get — "does
this step outside the system?" — is not answered by reading a diff: it is answered
by seeing it. So the first move is not to read, it is to **ask for what you need
in order to judge**.

## What to ask for, and from whom

From the repo's agent (with `bus_send` to their agent, or by replying to the
notice):

- **A screenshot of before and after**, of the normal state and one of the odd
  ones.
- **Which component was touched and who else uses it.** That is the question that
  changes the answer: the same change in one screen is a local decision, and in a
  shared component it is a system decision.
- **Whether it is visible to the user at all.** Plenty of notices die here, and
  rightly.

A notice arriving without a screenshot is not an incomplete notice: it is a
screenshot you have not asked for yet.

## The four states everyone forgets

Empty, loading, error, and no permission. They are in the role and they are
repeated here because they are half the real findings of a design review. A new
component almost never brings all four.

And two more that depend on your product: **negative numbers** and **very long
values** — whatever your domain, the edge that breaks tables is the one nobody
tested.

## When to say yes to something that steps outside

Not everything outside the system is wrong. What has to be avoided is it stepping
outside **without anyone knowing**. If the bespoke solution is better, the right
answer is: go ahead, and push it up into the design system so the next person does
not reinvent it. That is different from approving it and forgetting.

## When answering a notice

Make clear whether it is a **block** ("this cannot ship like that"), a **fix for
later** ("ship it, correct it next"), or a **non-problem** ("deliberate, that is
how it was agreed"). All three are valid and all three are useful. The one that is
not useful is a paragraph from which no action follows.

And remember the notice blocks nothing by itself: the PR carries on. If you think
it should not ship, that has to be said explicitly and to the person, not only to
their agent.
