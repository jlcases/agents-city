# Committee governance benchmark

This benchmark measures protocol structure: information leakage before independent
positions, lateral repo-to-repo edges, ungranted interruptions, unresolved floor
requests, and closure without independent verification. It deliberately does not
turn those properties into an answer-quality score.

The design choices follow primary findings rather than “more agents is better”:

- sparse communication can match or outperform fully connected debate at lower
  cost: [Li et al., 2024](https://arxiv.org/abs/2406.11776);
- collaboration topology materially affects scaling: [Qian et al.,
  2024](https://arxiv.org/abs/2406.07155);
- majority pressure can suppress independent correction: [Wu et al.,
  2025](https://arxiv.org/abs/2511.07784);
- the best decision protocol is task-dependent, and extra rounds can hurt:
  [Kaesberg et al., 2025](https://arxiv.org/abs/2502.19130);
- independent, non-communicating copies make cross-examination meaningful:
  [Brown-Cohen et al., 2023](https://arxiv.org/abs/2311.14125).
- unguided homogeneous debate can cost more while degrading accuracy through
  conformity, contextual fragility and plurality collapse:
  [Bertalanič and Fortuna, 2026](https://arxiv.org/abs/2605.00914);
- executive-style integration fails through single-advisor capture and
  historical amnesia even when plans are structurally valid:
  [Dai et al., 2026](https://arxiv.org/abs/2606.17459);
- not every changed stance is conformity, so influence history is a review
  signal rather than an automatic rejection rule:
  [Hao et al., 2026](https://arxiv.org/abs/2606.00820).

Run:

```bash
python3 benchmarks/committee/run.py
python3 benchmarks/committee/run.py --json
```

The checked-in traces make metric changes reviewable. The real state machine is
tested separately by `bin/test-committee.py`; a claim about task quality still
requires a preregistered live benchmark across tasks, models and costs.
