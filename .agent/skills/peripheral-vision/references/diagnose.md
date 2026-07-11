
# Root Cause — diagnosing before touching

## Why you're reading this

The expensive failure mode in debugging is not slowness — it's fixing the
symptom. The symptom-fix *works*: the error disappears, the test passes,
the report says done. The cause ships on, and resurfaces later wearing a
different symptom, in production, with your fix now camouflaging it.

The second expensive failure is pattern-matching: a signal that looks like
a failure you've seen before gets that failure's fix, without checking
that the mechanism is actually the same. Familiarity feels like diagnosis.
It isn't — a matched pattern is a *hypothesis*, and hypotheses are for
testing.

This protocol has one rule under all the others: **no fix before a
mechanism.** You are done diagnosing when you can tell the complete causal
story — from root cause to observed symptom, every link stated — and every
link is backed by something you observed, not something you inferred.

## Step 1 — Reproduce before anything else

A bug you can't reproduce is a bug you can't prove fixed; any fix you
apply to it is a superstition with a commit hash. So first, get a minimal,
reliable reproduction — the smallest input, the fewest steps, the least
setup that still shows the wrong behavior. Minimizing is not overhead:
every element you remove from the repro is a suspect eliminated, so by the
time it's minimal, the search space is already small.

If it won't reproduce, that fact is itself evidence — it points at state:
timing, caching, session, data that differs between environments. Don't
guess-fix an unreproduced bug; instrument instead (logging, capturing
state at the failure point) and wait to catch it in the act.

While you're here, write down the *exact* observed behavior and the exact
expected behavior, verbatim — error text, wrong value, actual vs.
intended. "It's broken" launders away the very details that discriminate
between causes.

## Step 2 — Write the hypothesis ledger

Before testing *any* theory, list *every* plausible cause you can think
of — in a file, not your head. The reason for writing them all first: the
moment you start investigating one, anchoring sets in, and evidence
against your favorite starts reading as noise. The ledger is your defense
against your own conviction.

For each hypothesis, note the cheapest observation that would
*discriminate* — confirm it or kill it. Then order your checks not by
which hypothesis feels likeliest, but by which observation **splits the
space best per unit cost**. Bisection beats intuition:

- **Bisect time**: did it ever work? Find the commit or date it broke;
  the diff between working and broken contains the cause by construction.
- **Bisect space**: which layer is the last one where the data is still
  right? Check the value at the boundary between layers — store vs. wire
  vs. render — and the bug is on the far side of the last good reading.
- **Bisect data**: which property of the failing input matters? Mutate
  the repro one property at a time toward a passing case.

Read actual values at each point — print them, query them, inspect them.
"The value *should* be X there" is precisely the assumption the bug is
hiding behind.

## Step 3 — Demand the mechanism

When a hypothesis survives its test, extend it into the full chain:
*root cause → intermediate effects → observed symptom*, every arrow
explicit. Then check the chain twice:

- **Does it explain everything?** All symptoms, including the weird ones
  — the detail that "doesn't matter" (only fails on Tuesdays, only the
  second save, only this user) is usually the fingerprint of the real
  mechanism. A theory that requires ignoring one observation is the wrong
  theory, however elegant.
- **What else does it predict?** A real mechanism has consequences beyond
  the symptom you started from. Predict one and check it. A theory that
  predicts something you *then observe* is diagnosis; a theory that only
  post-dicts what you already knew might just be a story.

Distinguish ruthlessly between "the symptom disappeared" and "the
mechanism is explained." Reordering two lines and watching the test pass
is not a diagnosis — it's a lottery ticket that currently happens to be
winning.

## Step 4 — The fix, aimed at the cause

- Fix where the chain *starts*, not where it hurts. Fixing downstream —
  catching the exception, defaulting the null, retrying the request —
  leaves the cause producing damage that now flows somewhere you're not
  looking.
- **Write the regression test before the fix** and watch it fail for the
  diagnosed reason. A test that fails for the right reason is the proof
  your mechanism story was true; a test written after can accidentally
  pass for unrelated reasons and guard nothing.
- **Hunt the siblings.** A real root cause almost never has exactly one
  instance: the same misunderstanding was probably typed in more than one
  place. Grep for the pattern; check the other call sites. Fixing one
  instance of a class of bug and closing the ticket is how the same bug
  gets diagnosed from scratch next month by someone else.

## The tripwire: two failed fixes

If you've fixed this bug twice and it's back — or your fix changed the
symptom instead of removing it — stop. Your *model* of the bug is wrong,
and a third fix built on the same model will fail the same way. Go back
to the ledger: re-read the hypotheses you dismissed, re-check the
observation that anchored you, and widen — the real cause is usually in
territory your current model treats as irrelevant. Escalating honestly
("my mechanism story failed twice; here's the ledger and the evidence")
is a better outcome than a third confident wrong fix.

## Reporting a diagnosis

Whether or not you also fixed it, a diagnosis report contains: the minimal
repro; the mechanism story with the evidence for each link; why the fix
(if any) addresses the *first* link; the regression test and what it
guards; sibling instances found and their status; and any hypotheses that
remain unkilled. That last item matters most when you're wrong — it's the
map your successor starts from instead of starting from zero.
