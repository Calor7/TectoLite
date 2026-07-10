# BRIEF_01 — Ship v0.2.0: visual QA pass, bookkeeping, release cut

Release: v0.2.0 "Foundation" · Size: S · **Human-in-the-loop required**

## Goal and why

Eight commits of foundational work — the keyframe-less motion model (v4 flag
day), isochron oceans, the save-migration layer, restructure tasks 1–6 — sit
unreleased on branch `Automatation-3rd-try`. The motion-model rewrite changed
how every plate moves and has **never had its manual visual pass**. Until
this ships to `main` with a tag, every new feature stacks risk on unverified
ground, and `main` (what a contributor or CI release would build) is stale.

This brief produces: a completed visual QA checklist, corrected planning
docs, a CHANGELOG, a version bump, `main` fast-forwarded and tagged.

## The map

- Branch state: `Automatation-3rd-try` is a direct descendant of `main`
  (merge-base = `main` = `1afc7ee`), so the merge is a **fast-forward** — no
  merge commit, no conflicts.
- Visual checklists already written, scattered in three places:
  `docs/PLAN_rotation_model.md` (motion-model checklist), and the memory
  handover notes' test lists reproduced below.
- Version lives in `package.json` (`0.1.3`). No CHANGELOG exists yet.
- Status bookkeeping: `docs/restructure-tasks/MASTER_PLAN.md` Status section.

## Work items

1. **Visual QA pass (the user drives; you assist and record).** Run the app
   (`npm run dev`), walk this checklist, record pass/fail per item in a new
   `docs/QA_v0_2_0.md`:
   - Draw plate → set motion → play/scrub: geometry follows segments.
   - Retroactive rate change on a plate **with children**: children follow;
     scrub back/forward stable.
   - Edit tool → "Apply at Generation" on a moving plate: shape changes from
     birth, no position jump at current time.
   - Edit tool → "Insert Event at Current Time" → then retime/delete that
     event in the timeline: geometry honors the stage at all times.
   - Split after motion changes; both children inherit correctly.
   - Link A→B (motion inheritance) across a time window; unlink; verify
     child is independent outside the window.
   - Expanding Rifts ON: split → rings appear symmetric; change motion →
     rings re-derive without artifacts; scrub back → rings shrink cleanly.
   - Triple junction: 3-way split → wedge fills tile without gaps.
   - Save → reload (v4 roundtrip). Load an old v1/v3 save if one exists.
   - Undo/redo across all of the above.
2. **Fix MASTER_PLAN bookkeeping**: tick Phase 0 and Phase 1 checkboxes,
   annotate with commits `4215f16` / `26cc057`. (Done 2026-07-10 by the
   roadmap session if you find them already ticked — verify, don't re-do.)
3. **Create `CHANGELOG.md`** at repo root. One `## 0.2.0` section, human
   phrasing, grouped Added/Changed/Fixed/Removed. Source it from
   `git log 1afc7ee..HEAD --oneline` — do not pad it with restructure
   minutiae; a user reads this.
4. **Bump `package.json` version to `0.2.0`.**
5. **Release cut** (only after checklist passes and the user approves):
   `git checkout main && git merge --ff-only Automatation-3rd-try`, tag
   `v0.2.0`, push branch + tag.
6. **Branch inventory report** (report only): list the 15 non-main local
   branches with last-commit date and whether their content is reachable
   from the new main; recommend keep/archive per branch. **Do not delete
   anything.**

## Invariants and traps

- Any checklist failure **stops the release**. File the failure precisely
  (repro steps, expected/actual) in `docs/QA_v0_2_0.md`; fixing it is a new
  Diagnose task, not part of this brief.
- The dev server is Vite; canvas behavior cannot be verified from a green
  build — that is the entire reason this brief exists.
- `--ff-only` is deliberate: if it fails, `main` moved — stop and report,
  do not create a merge commit.

## Decision log

- Version is 0.2.0 (not 1.0): the motion model is new; semver-ish caution.
- CHANGELOG format: Keep-a-Changelog style, newest first, no unreleased
  section yet.
- Stale branches are reported, never deleted — several may hold unmerged
  experiments (`ocean-rework`, `Test-keyframe-less` are ancestors of this
  work, but e.g. `BETTER-OROGONY`, `Event-Timeline` are unknown).

## Acceptance criteria

- [ ] `docs/QA_v0_2_0.md` exists with every checklist item marked pass (or
      the release is stopped with failures filed).
- [ ] `CHANGELOG.md` exists; `package.json` says `0.2.0`.
- [ ] `main` == former `Automatation-3rd-try` head + release commit; tag
      `v0.2.0` exists and is pushed.
- [ ] Branch inventory report delivered in the final message.
- [ ] `npm run verify` and `npm run lint` green on the tagged commit.

## Non-goals

- No bug *fixes* (failures stop the release instead), no new features, no
  branch deletion, no npm publish / electron-builder distribution (that is
  a separate, user-driven step).

## Authority boundaries

- Merging to `main`, tagging, and pushing require explicit user go-ahead
  **after** they have seen the QA results. Everything before that is local
  and reversible.

## Report format

Final message: QA table (item → pass/fail), files changed, exact git
commands run (or proposed, if awaiting approval), branch inventory table,
out-of-scope findings appended to `docs/restructure-tasks/out-of-scope-list`.
