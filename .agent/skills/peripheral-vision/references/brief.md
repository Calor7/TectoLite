
# Decision-Complete Briefs — delegating without losing the plot

## Why you're reading this

When you delegate, the executor's field of view *is the brief*. They can't
see the conversation that produced it, the alternatives you rejected, or
the landmines you know about. Every decision the brief leaves open gets
made by the party with the least context, at the worst time, under
pressure to just pick something and keep moving — and a capable executor
will pick *plausibly*, which is worse than picking badly, because
plausible wrong choices survive review.

"Decision-complete" is the standard: an executor should never face a fork
where two readings of the brief are both reasonable. Reaching it costs you
an hour of deciding up front. Not reaching it costs a full round-trip:
wrong implementation, review, re-brief, re-implementation.

## The anatomy

Order matters less than presence. A brief is decision-complete when it has:

- **Goal and why.** Not just what to build — what it's *for*, who uses it,
  what problem dies when it ships. Motivation is what lets a smart
  executor make the thousand micro-decisions you can't enumerate, in your
  direction instead of a random one. A brief without a why produces
  literal compliance and nothing more.
- **The map.** Where the relevant code/material lives, and — most
  important — **the nearest sibling to imitate**: "this feature should be
  wired everywhere X is wired; trace X first." One good pointer to an
  existing pattern outperforms a page of abstract instructions, because
  the pattern carries details you'd forget to write.
- **Invariants and traps.** The constraints that are invisible from
  inside the task: the serializer that must pass unknown fields through,
  the table where everything lives in one JSONB column, the auth object
  that gets replaced hourly. You know these because they've drawn blood
  before. The executor doesn't. Every known trap you leave out of the
  brief is a coin-flip on rediscovering it the expensive way.
- **Acceptance criteria, each one checkable.** "Works correctly" is not a
  criterion; "saving an entry with an image and reloading shows the image"
  is. Write them as the checklist the reviewer will literally walk —
  because they will, and the executor should be able to walk it first.
- **Non-goals.** The scope fence, stated explicitly: what this brief
  deliberately does not cover, what nearby mess should be *reported, not
  fixed*. Without the fence, diligent executors expand scope out of
  helpfulness and hand review a diff that's half surprises.
- **Degraded-path expectations.** What should happen when the world is
  unhealthy: missing migration, anonymous user, failed request. If you
  don't specify "degrade this feature only," you'll get "crash the page"
  half the time.
- **Verification gates and report format.** Name the exact commands that
  must pass, and the structure the final report must have (what changed
  with exact paths, what was verified with output, what needs manual
  checking, what was noticed but not done). A specified report format
  makes review mechanical; an unspecified one makes every report a novel.
- **Authority boundaries.** What the executor may NOT do without stopping:
  commit, apply migrations to a live database, deploy, delete data, touch
  work-in-progress that isn't theirs. Irreversible actions are yours to
  authorize, and silence authorizes nothing. Also state the stopping
  rule: a precise blocker report is a *successful* outcome; grinding past
  a conflict with reality is not.

## The decision log

While writing the brief you will resolve forks — this library or that
one, extend the old table or add a new one, warn or block. Record every
fork you resolved and the choice, in the brief itself. Two reasons: the
executor treats them as settled instead of re-deciding them, and the
reviewer can check the executor actually followed them. A fork you
resolved silently in your head is a fork the executor will re-open.

## Red-team your own brief before sending it

Read the finished brief once more wearing the executor's hat: a smart
stranger with zero context beyond this document and the repo. Every
question they would have to ask is a hole. Every place where two readings
are both reasonable, assume they take the one you didn't mean — because
across enough dispatches, they will, at the base rate. Fix the text, not
the odds.

Then check the brief's *size*: one brief should produce one session's
work and one reviewable diff. If you can't hold the expected diff in your
head, split the brief. And never let two briefs run concurrently in the
same working tree — parallel executors in one tree silently destroy each
other's work, and neither one's report will know it happened.

## What a decision-complete brief buys you

The executor works at their best because judgment was pre-loaded, not
improvised. The reviewer works mechanically: criteria in one hand, diff in
the other. And you find out whether your *plan* was wrong — cleanly,
without the noise of interpretation drift on top. When a well-briefed task
still fails, the brief is where to look first: the next revision of the
brief is usually cheaper than the next revision of the code.
