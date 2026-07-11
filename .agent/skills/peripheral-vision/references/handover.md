# Handover — transferring a session without losing the plot

## Why this protocol exists

Your successor — future you after a context reset, a different agent, or
the owner — starts from zero. Everything you don't write down is gone, and
half-written state is worse than none: it *misleads*, because it reads as
complete. The test for a handover is brutal and simple: **a stranger must
be able to act on it without asking a single question.**

One timing rule above all: **start the handover before your context budget
is nearly spent.** A handover written in the last five percent of a long
session is written by the most degraded version of you, about the most
complex state of the session. The cheap way to obey this: maintain your
working file (PLAN / LEDGER / OUT-OF-SCOPE) throughout — then the handover
is that file's final edit, not a memoir reconstructed at midnight.

## Contents, in order

1. **State of the world.** Three buckets, no blending:
   - DONE — with the evidence (which gates passed, when, what was probed).
   - IN PROGRESS — the exact next action, mid-flight state included:
     branch and commit, dirty files and whose they are, which checkpoint
     of the plan you're inside, what's half-wired.
   - NOT STARTED — so the successor doesn't infer completion from silence.

2. **Verified vs believed.** Separate what you personally checked from
   what you assume or were told, and label each believed item with *how to
   verify it* (the command, the probe, the file to read). Unverified
   claims poison a successor harder than they poison you — you at least
   remember the doubt; they inherit only the confidence.

3. **Decisions made, with the why.** Every fork you resolved, so the
   successor doesn't re-litigate settled questions — including rejected
   alternatives when the rejection reason isn't obvious from the outcome.
   A decision without its why gets reversed by the next smart person to
   look at it.

4. **Traps discovered.** Anything that cost you more than ~15 minutes gets
   one line: the quirk, the misleading error, the workaround. This is the
   cheapest section to write and the most expensive to omit — unwritten
   traps get re-sprung at full price, once per successor.

5. **Where things live.** Exact paths and artifact names, copied from `ls`
   output — not retyped from memory. (A handover once cited a migration
   file one digit off from its real name; the successor chased a file
   that didn't exist.)

6. **Open questions, split by who can answer.** Questions only the owner
   can resolve vs. questions the successor can investigate. Mixing them
   stalls the successor on things they could have just gone and checked.

7. **The next-to-do queue.** Ordered, one action per entry, each labeled
   with who acts — `[OWNER]` vs `[AGENT]`. Agent entries must be
   dispatch-ready: a stranger could start work from the entry alone. If an
   entry is big enough to need a brief, *write the brief first* (see
   brief.md) and point to it — "write the brief" is not a queue entry,
   it's an unfinished handover.

## The fresh-eyes test

Before closing, re-read the handover as the successor: no context except
this document and the repo. Can you execute queue entry 1 without asking
anything? Every question you'd need to ask is a hole — fix the document,
not the successor's luck.

## Anti-patterns

- **The memoir.** A narrative of your session, in the order you lived it.
  The successor needs state, not story — what is true *now*, not how it
  got that way (the why-of-decisions section covers the part of the story
  that matters).
- **"Various fixes applied."** Name them or they didn't happen.
- **Optimism at the boundary.** "Should work now" at the end of a session
  is the single most expensive phrase in delegation. Say what was
  verified, what wasn't, and which command tells the difference.
