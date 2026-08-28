# Repo-owned skill examples

These are examples for repository maintainers, not Agents City features.

Copy and adapt a relevant example inside the repository whose agent should own
it, using a location supported by that runtime, for example:

```text
my-repo/.claude/skills/<name>/SKILL.md
my-repo/.codex/skills/<name>/SKILL.md
my-repo/.agents/skills/<name>/SKILL.md
```

Agents City does not install or copy these files. It only recognises live
repo-local manifests for the Hall and `agents-city skills`; the repo's agent
runtime remains responsible for deciding whether a skill applies to a request.

This `examples/` directory is deliberately outside the npm package allowlist.
