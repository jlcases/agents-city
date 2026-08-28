---
name: prompt-eval
description: Change a prompt, a model or the limits of a model call without breaking what worked — baseline, cases, cost and latency. Use it before touching a prompt in production, when switching models or versions, and when answering what something costs or why a model was chosen.
---

# Evaluating an LLM change

The property belongs to whoever holds the machinist seat. The domain is in
`roles/llm-engineer.md`.

## A prompt in production is code without tests

Which is why the characteristic failure is not that the prompt comes out wrong:
it is that **nobody knows whether the change improved anything**. A prompt tweaked
by feel works on the example it was tried with and fails on the three cases nobody
looked at again.

The minimum rule: **before changing a prompt, have something to compare against.**

## What you need before touching it

1. **Cases.** Ten real inputs from the system, not invented, with what should come
   out. If there are not ten, the prompt is not understood yet.
2. **The baseline.** Run the cases with the current prompt and save the result.
   Without this there is no comparison, only opinion.
3. **Starting cost and latency.** Input and output tokens per call, and how many
   calls a day. A change that improves quality by 5% and triples cost is a
   business decision, not a technical one, and has to be presented as such.

## When switching models

- **Pin the version.** A model with no pinned version changes underneath you, and
  the day it changes the blame will look like the code's.
- **An expensive model on a simple task is the most common waste.** Classifying,
  extracting fields or reformatting almost never needs the big one.
- **And the other way round**: dropping to a smaller model without running the
  cases is how a product degrades in silence.

## Data leaving for a provider

Before a prompt carries user data, check whether it goes masked. A prompt with an
identity document inside it is not a quality problem, it is a different kind of
problem.

## When answering an LLM notice

With numbers. "It is fine" is not an answer: how many calls, which model, what it
costs a month, and which evaluation backs the last change. If there is no
evaluation, saying so is also an answer — and probably the most useful one.
