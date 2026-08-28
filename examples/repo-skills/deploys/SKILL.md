---
name: deploys
description: Where each app runs and who owns each layer. Use it before deploying, before changing a workflow, before touching an environment variable, and before trusting an infrastructure document — this is where you find out which doc is alive and which one is superseded.
---

# Deploys

This skill does **not** explain your hosting. Whoever maintains it already wrote
that, and better than a summary here would. What it does is tell you **where the
truth of each layer lives** and **what not to touch** — the things an agent
cannot deduce from the repo in front of it.

## Source of truth per layer

Fill this in for your setup. The rule that matters is the split:

| Layer | Where | What you find |
|---|---|---|
| The machine | your infrastructure repo | Terraform, cloud-init, firewall, SSH, restore |
| The application | the app's own repo | what deploys, with which workflow, which env var lives where |

The rule they use, and worth respecting when you write: **if the answer changes
when you change app, it goes in the app repo; if it changes when you change
server, it goes in the infrastructure repo.**

## Before trusting an infrastructure document

Infra docs rot faster than anything else, and the dead ones are dangerous
because they read exactly like the live ones. Look for the banner before the
body: a `SUPERSEDED` header at the top of a document means every command below
it is a trap — the access method changed, the host moved, the tool is now
elsewhere.

A document without a banner is not necessarily current. One with a banner is
certainly not.

## What not to "fix"

Some things look like broken configuration and are deliberate:

- **Deploys disabled from git.** If a project turns off automatic deployment and
  *also* has a workflow cancelling anything that slips through, that is two
  layers of the same decision: somebody decided a human launches those. Do not
  re-enable it.
- **Pinned versions.** A dependency stuck two majors back is usually a decision
  with a reason nobody wrote down. Ask before bumping.
- **Manual workflows.** A deploy that is not automated is not always a missing
  automation.

All three are the same shape: *deliberate, undocumented, and indistinguishable
from debt*. When you find one, ask the repo owner — and when they answer, write
it down so the next agent does not ask again.
