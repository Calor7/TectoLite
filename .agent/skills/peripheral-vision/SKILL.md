---
name: peripheral-vision
description: >
  First point of contact for all substantial code work — routes to the right
  sub-protocol and supplies the shared discipline. Use whenever the task says
  "implement", "build", "add", "fix", "debug", "why does this happen",
  "review", "verify", "check this agent's work", "write a brief", "spec this
  for delegation", or "hand over / wrap up the session" — and whenever a code
  change spans more than one file or layer, even if it looks simple. For
  non-code work (design, art, writing, strategy, general problem solving) use
  the sibling skill wide-lens instead.
---

# Peripheral Vision — base protocol and router

This skill is one entry point to five protocols. They exist for one shared
reason: the failures they prevent are almost never skill failures — they are
*field-of-view* failures, made by capable models doing exactly what was
asked, looking only where the task pointed, and missing something one hop
away. Each protocol is a set of concrete moves that substitutes for the
peripheral vision you don't have while your attention is down inside the
work. Every incident cited in them really happened.

## Step 1 — Route the task

Identify which mode you are in and read that file **before starting the
work** (not all five upfront — only what the task needs):

| The task is... | Mode | Read |
|---|---|---|
| Build or change something a brief/spec describes | Implement | references/implement.md |
| Behavior differs from expectation and the cause is not yet proven | Diagnose | references/diagnose.md |
| Check work delivered by another agent, contractor, or past session | Review | references/review.md |
| Prepare a task for someone else to execute without you | Brief | references/brief.md |
| End a session or transfer work to a successor | Handover | references/handover.md |

**Modes chain — route again at every transition:**

- "Fix this bug" is Diagnose *then* Implement. Never skip Diagnose when the
  cause is unproven: a fix without a mechanism story is a symptom-fix, and
  the cause ships on.
- A Review that finds a deep defect enters Diagnose before judging it.
- Any long session ends in Handover — and Handover warns you to start it
  *before* your context budget is nearly spent, so check that file early if
  the session is going to be a long one.
- Writing a Brief for a bug you haven't diagnosed usually means Diagnose
  first; a brief built on an unproven cause delegates a guess.

## Step 2 — The spine (applies in every mode)

The references expand these; they are never optional:

- **Write your state down.** One working file with three sections: PLAN
  (goal restated in your own words, checkpoints checked off only with
  evidence), LEDGER (every assumption, marked `probed` or `unverified`),
  OUT-OF-SCOPE (noticed but not this task — surfaced in the report, never
  silently fixed or silently dropped). Re-read the whole file at every
  checkpoint; the re-read is your substitute for seeing everything at once.
- **Probe, don't assume.** Anything cheap to check against reality —
  a table's existence, a migration's status, what a file actually says —
  check. Memory and briefs are testimony; the system is the fact.
- **Never claim a check you didn't perform.** A skipped check honestly
  reported is recoverable; a fabricated one poisons everything downstream.
- **Stopping precisely is a successful outcome.** Stop and report when the
  task conflicts with reality, when scope keeps growing, when you're
  entering irreversible territory without explicit authority (commits,
  live migrations, deploys, deleting data, others' in-flight work), or
  when the same approach has failed twice — the third try won't differ;
  widen instead.

## Growing this skill

New protocols join as new files in references/ plus one row in the routing
table — the entry point and trigger description stay stable. Keep each
reference self-contained (readable standalone, e.g. when embedded directly
into an external agent's prompt without this router).
