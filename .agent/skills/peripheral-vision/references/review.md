
# Forensic Review — verifying work you didn't watch happen

## Why you're reading this

An agent's report is testimony, not evidence. It is written by the party
with the strongest interest in the work being judged complete, by a model
whose memory of what it did is itself reconstructed. Capable agents produce
confident, detailed, *plausible* reports that are sometimes false — not
usually from malice, but because "I intended to run it" and "I ran it"
compress to the same sentence.

> Incident: an agent reported it had "verified by stashing changes and
> confirming the bug reproduces." It never invoked git at all. The report
> was fluent and specific. Only checking the actual shell history caught it.

Review is where delegation earns its cost. A rubber-stamp review is worse
than none, because it converts the delegate's overconfidence into yours.

## Ground truth before testimony

Establish what physically happened *before reading the report's claims*,
so the report can't frame your perception:

1. `git status`, `git stash list`, `git log --oneline -5`,
   `git diff --stat` (against the right base). This is the actual footprint.
2. Compare the report's claimed file list against the diff's actual one,
   both directions. Files changed but never mentioned are the highest-signal
   finding there is — they're where scope creep, accidents, and clobbered
   bystander code live. Files mentioned but not changed mean the report is
   partly fiction.
   > Incident: a report cited a migration file by a name that didn't exist
   > (one digit off). Trivial to catch by `ls`; expensive to catch after
   > you've told the owner to apply it.
3. Note anything in the tree that predates the work (stashes, foreign
   uncommitted files). Verify the delegate left it alone.
   > Incident: an agent running concurrently in a shared tree silently
   > wiped another feature's freshly-wired code. The diff showed it; the
   > report didn't know it had happened.

## Read the whole diff against the brief

Two passes over the complete diff, different questions:

- **Pass 1 — does it do what was asked?** Walk the brief's acceptance
  criteria one at a time and point at the lines that satisfy each. A
  criterion you can't point to is unmet, whatever the report says. Check
  the *wiring* especially: a feature exists everywhere its siblings exist
  (editor, display, persistence, filters) or it's fractional.
- **Pass 2 — what else does it do?** Every hunk that no acceptance
  criterion explains needs its own explanation: necessary supporting
  change, silent scope expansion, or accident. Make the delegate's report
  account for each, or account for it yourself.

While reading, wear the hats the author probably didn't (they're the
narrow-FOV model; you're the wide one — that's the whole point of the
role): does this change *observably* do anything (a filter on the wrong
layer is a no-op that reads fine)? What happens on the degraded path — the
migration not applied, the anonymous user, the failed request? What does a
hostile user see — is the security boundary server-side, or is it client
decoration?

## Calibrated trust on claimed verification

Re-running everything the report claims doubles the cost of delegation and
is usually waste. Instead:

- Don't re-run gates the report claims green — but **spot-check one cheap
  claim per report, chosen unpredictably.** Ask for the test count, check
  one command's described output, `ls` one named artifact. The point isn't
  the one check; it's that a single caught fabrication reclassifies the
  entire report from "testimony" to "fiction," and every future report
  from that configuration gets the expensive treatment.
- Probe live state independently for anything the report *assumes* rather
  than did: is the migration actually applied? Is the deployed endpoint
  actually the new version? Read-only probes against the real system beat
  any amount of report prose, in both directions — probes have caught
  "not applied" claims that were applied, and "applied" claims that
  weren't.
- Run gates yourself only for changes *you* make during review — your
  fixes get the same standard the delegate's work did.

## Findings: fix, return, or record

Sort every finding into exactly one bucket:

- **Small and certain** — fix it yourself, run the gates on your fix, note
  it in the verdict. Cheaper than a round-trip, and the fix documents the
  finding precisely.
- **Big or ambiguous** — return to sender (or escalate) with a precise
  reproduction and the acceptance criterion it violates. Don't half-fix a
  design problem inside a review.
- **Real but out of scope** — into the project's backlog files, *before*
  the review closes, with enough context to act on later. A finding that
  lives only in the review conversation is a finding lost. The review
  isn't done until the backlog is updated — this includes findings the
  delegate's own report surfaced.

## The verdict

Your review's output is consumed by someone deciding whether to ship,
so it separates knowledge from belief:

- **Verified** — what you personally checked, and how (command, probe,
  diff reading). This is the only section allowed to sound confident.
- **Accepted on testimony** — what you're taking from the report without
  re-checking, explicitly labeled as such.
- **Fixed in review** — your changes, with gate results.
- **Remaining for a human** — manual visual passes, migrations to apply,
  anything needing accounts/devices/taste you don't have. Be specific
  enough that the human can execute it as a checklist.
- **Backlog delta** — what you added to the backlog files.

A review that ends "looks good" has produced nothing. A review that ends
"verified X by Y; accepted Z on testimony; fix A applied; human must do B"
has produced a decision-ready state of the world.
