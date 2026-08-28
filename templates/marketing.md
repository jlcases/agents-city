# Marketing

> Channels, campaigns and pieces. What lands is something published.

kind: marketing
name: Marketing
parcel: a channel or a campaign (a folder)
parcel_source: disk
grows_with: published pieces
grow_command: find . -name "*.md" -newer .city-last -print | wc -l

## Suggested units

# Rename, drop, add. These are the districts of your map.
units:
  - Brand ; 8f7ae6
  - Acquisition ; e08a3c
  - Lifecycle ; 4a9ede
  - Content ; 3fb8a0

## Roles

# Possible seat roles for this kind. The Hall offers these first.
roles:
  - brand-lead  # on by default
  - content  # on by default
  - performance  # on by default
  - seo  # on by default
  - lifecycle
  - data
  - product-design

## Notes

The two properties that behave like data engineering, and surprise people:

**URLs.** A slug change splits a year of reporting and breaks accumulated
organic authority, and nothing fails while it does. That is why `seo` gets a
notice for any route change.

**Tracking.** A renamed conversion event or a dropped parameter stops the
measurement without erroring. Same rule as engineering: when in doubt, notify.

## What does not change

Whatever this template sets up, the contract is the same: one current goal for
the city seat, with an honest command or qualitative judgement that measures it.
The role adapts, the districts adapt, what a parcel is adapts. That does not.
