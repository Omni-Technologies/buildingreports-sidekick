# New-rule request template

Copy this into a request when asking for a new cleanup rule. The more of
this is filled in up front, the less back-and-forth (and the less risk of
guessing) it takes to implement correctly. Blank sections are fine when
genuinely unknown — that's a signal to investigate live before coding, not
to guess.

```
Cleanup action:
  (Clean Up Service Entries / Battery Cleanup / a new action)

Devices affected:
  (exact Device Type string(s) - not a category description)

Reports affected:
  (Annual / Semi-Annual / both / universal regardless of profile)

Fields read:
  (which BuildingReports field(s) the rule needs to look at)

Fields changed:
  (which field(s) the rule is allowed to write - nothing else)

Exact condition:
  (the precise trigger - not "if it looks wrong", the literal rule)

Exact output:
  (the precise resulting value/format - spell it out, don't leave it to
  interpretation)

Missing-data behavior:
  (what happens when a required input is blank/invalid - flag for review?
  leave untouched? never invent a value)

Information that must be preserved:
  (existing notes, history, formatting quirks that must survive unchanged)

Preview requirements:
  (what counts/categories/examples should Preview surface for this rule)

Example inputs and expected outputs:
  before: ...
  after:  ...
  (as many pairs as needed to cover the safe cases AND the cases that must
  NOT be touched)
```
