# Finance & operations

> Processes and periods. What lands is a period closed or a cycle run.

kind: finance
name: Finance & operations
parcel: a process (a folder)
parcel_source: disk
grows_with: closed periods or completed runs
grow_command: ls -1 closed 2>/dev/null | wc -l

## Suggested units

# Rename, drop, add. These are the districts of your map.
units:
  - Accounting ; 3fb8a0
  - Payroll ; 8f7ae6
  - Procurement ; e08a3c
  - Treasury ; 4a9ede

## Roles

# Possible seat roles for this kind. The Hall offers these first.
roles:
  - cfo  # on by default
  - controller  # on by default
  - fin-analytics  # on by default
  - ops  # on by default
  - compliance

## Notes

`fin-analytics` owns comparability, which is the thing nobody notices breaking:
a definition changed mid-period leaves two numbers that look like one series and
are not. Same shape as a renamed analytics event.

Controls are notices, not gates. A skipped control gets reported to whoever owns
the books; it does not block the entry. A notice that blocks stops being sent.

## What does not change

Whatever this template sets up, the contract is the same: one current goal for
the city seat, with an honest command or qualitative judgement that measures it.
The role adapts, the districts adapt, what a parcel is adapts. That does not.
