---
id: software
order: 10
name: Software development
summary: Build, operate and evolve software products and their repositories.
parcel: a repository or working folder
source: github|disk
grows_with: verified changes shipped
grow_command: git log --since=30.days --oneline | wc -l
roles:
  - cpto  # on by default
  - dev  # on by default
  - data-engineer  # on by default
  - devops  # on by default
  - data  # on by default
  - product-design
  - po
  - llm-engineer
  - ai-manager
  - blank
units:
  - Platform ; 3fb8a0
  - Product ; e08a3c
  - Mobile ; 8f7ae6
  - Data ; 4a9ede
---
# Software development

The city coordinates evidence and decisions across repositories. A support
agent owns the context of its repo; the seat owns direction and the final call.

Ask for reproducible code, tests, logs and diffs. Treat a green build as evidence
for the checks it ran, not proof that the product behaves correctly. Changes to
public interfaces, schemas, security, costs, analytics or shared UI should reach
the relevant role even when the code itself still compiles.

Repo skills stay in their repos and are invoked by their own runtime.
