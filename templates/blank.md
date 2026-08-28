# Start from scratch

> You define everything: units, roles, what a parcel is, and what growth means.

kind: blank
name: Start from scratch
parcel: whatever you decide (a repo or a folder)
parcel_source: github|disk
grows_with: whatever your grow command counts
grow_command: 

## Suggested units

# Rename, drop, add. These are the districts of your map.
units:

## Roles

# Possible seat roles for this kind. The Hall offers these first.
roles:
  - cpto  # on by default
  - dev  # on by default

## Notes

Pick this when none of the others fit. The Hall offers two roles to start with;
choose one for this city's seat and define the rest of its map yourself.

One piece of advice from the other templates: whatever your parcels are, define
**one command that returns a number** for growth, and put it in each folder. The
map does not care whether that number is merged PRs, filed documents or closed
periods — it cares that the number is real and that nobody has to be asked for
it.

## What does not change

Whatever this template sets up, the contract is the same: one current goal for
the city seat, with an honest command or qualitative judgement that measures it.
The role adapts, the districts adapt, what a parcel is adapts. That does not.
