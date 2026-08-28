---
name: workspace
description: Pull and push information in a documents suite — spreadsheets, docs and drives — when a report or a team number does not live in a repo. Use it when building a recurring report, reading data that lives in a sheet, or writing down something that will be read without an agent.
---

# Documents and spreadsheets

A good part of what gets decided in any organisation is not in a repo: it is in a
spreadsheet somebody opens every Monday. This skill is for crossing that border
without breaking anything.

## The rule that avoids the disaster

**Never write over a sheet you have not read in full.** A shared sheet has
formulas, filters and references from other sheets that are invisible from a
single cell. Before writing:

1. Read the structure: tabs, headers, which rows are data and which are summary.
2. If you are adding, **append rows at the end**; do not reorder or sort columns.
3. If you are changing something that exists, say what you are going to change
   first and wait for confirmation.

A broken sheet shows up weeks later, when somebody looks at the summary and it
does not add up.

## When a sheet is the right place

**Yes**: a report that gets read without an agent, data people type by hand,
something to share with whoever does not use a terminal.

**No**: anything that is the source of truth of a system. If a process reads from
a sheet in order to work, that is not a report, it is a database with no backups
and no access control. When one of those turns up, that is the finding.

## Tools

With the suite's connectors available, the operations are direct: read, append,
update and search on sheets; search, read, create and share on the drive.

**You may not have them**: they belong to each person's account, not to the
plugin. If they are missing, say so and hand over the content as text or CSV; do
not fake a write that did not happen.

## When sharing

Check who it is shared with before sharing, and do not widen permissions on a
document that is not yours. An internal document's link pasted in the wrong place
is a leak, even if nobody reads it.
