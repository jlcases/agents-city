# Product & engineering

> Repos and the code inside them. What lands is a merged pull request.

kind: product
name: Product & engineering
parcel: a slice of a repo (a path, or the whole thing)
parcel_source: github|disk
grows_with: merged pull requests
grow_command: gh search prs --repo {repo} --merged --json number --jq length

## Suggested units

# Rename, drop, add. These are the districts of your map.
units:
  - Platform ; 3fb8a0
  - Growth ; e08a3c
  - Mobile ; 8f7ae6
  - Data ; 4a9ede

## Roles

# Possible seat roles for this kind. The Hall offers these first.
roles:
  - cpto  # on by default
  - dev  # on by default
  - devops  # on by default
  - data  # on by default
  - product-design
  - po
  - llm-engineer
  - ai-manager

## Notes

A house grows when a PR **lands**, not when it is opened. That is deliberate: it
rewards finishing, not typing. Open PRs show as scaffolding, and scaffolding
older than two weeks turns amber — work stuck in the open is the thing worth
seeing, and most teams have far more of it than they think.

## What does not change

Whatever this template sets up, the contract is the same: one current goal for
the city seat, with an honest command or qualitative judgement that measures it.
The role adapts, the districts adapt, what a parcel is adapts. That does not.
