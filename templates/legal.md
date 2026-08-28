# Law firm

> Matters and clients. What lands is a matter closed or a document filed.

kind: legal
name: Law firm
parcel: a matter or a client (a folder)
parcel_source: disk
grows_with: documents filed or matters closed
grow_command: ls -1 filings 2>/dev/null | wc -l

## Suggested units

# Rename, drop, add. These are the districts of your map.
units:
  - Corporate ; 3fb8a0
  - Litigation ; d1728f
  - Employment ; e08a3c
  - IP ; 4a9ede

## Roles

# Possible seat roles for this kind. The Hall offers these first.
roles:
  - managing-partner  # on by default
  - associate  # on by default
  - compliance  # on by default
  - knowledge
  - ops

## Notes

`compliance` is the equivalent of the data seat, and for the same reason: a
missed deadline or a broken record cannot be recovered afterwards. It is the one
role where the rule is *when in doubt, notify*.

And `knowledge` exists because the expensive waste in a firm is not slow
drafting — it is the same clause drafted from scratch three times because nobody
knew it existed.

## What does not change

Whatever this template sets up, the contract is the same: one current goal for
the city seat, with an honest command or qualitative judgement that measures it.
The role adapts, the districts adapt, what a parcel is adapts. That does not.
