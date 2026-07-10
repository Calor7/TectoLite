# BRIEF_10 — Correctness hardening: high-risk tests, CI gate, known-bug sweep

Release: starts with v0.2.0, then continuous · Size: M · Absorbs TASK_18 + TASK_19

## Goal and why

Test coverage concentrates where the code is already pure and calm
(RotationModel, sphericalMath, importHelpers, migration — 76 tests), while
the intricate, bug-historied logic ships untested: SplitTool (~1,400 lines
of geometry heuristics), FusionTool, BoundarySystem, SimulationEngine's
derivation pipeline. Every regression this roadmap's features could cause
lands exactly there. Meanwhile CI (`.github/workflows/build.yml`) builds
but gates nothing on coverage, and a handful of *known, recorded* defects
sit in `docs/restructure-tasks/out-of-scope-list` waiting to bite.

This brief = TASK_18 + TASK_19 executed, plus the known-defect sweep, so
that v0.3's mechanic work lands on pinned ground.

## The map

- Task briefs to execute as written:
  `docs/restructure-tasks/TASK_18_add_tests_high_risk.md` (what to test
  per system, including how to make SplitTool testable) and
  `TASK_19_add_ci_coverage.md` (workflow + gate; coverage target ≥15%
  per MASTER_PLAN completion criteria).
- Existing test idioms to imitate: `src/motion/RotationModel.test.ts`
  (synthetic plates, golden scenarios), `src/migration.test.ts`
  (shape-based assertions on raw JSON).
- CI: `.github/workflows/build.yml` — extend, don't duplicate workflows.
- Known defects (from `out-of-scope-list`, verify each still reproduces
  before fixing — they were recorded 2026-07-05):
  1. `src/ui/SpeedPresets.ts` `applySpeedToSelected` mutates the active
     euler pole's `rate` in place, bypassing `addMotionSegment` (no
     history pinning, no event record). Audit callers: if the standalone
     export is dead, delete it; if live, route through the segment path.
  2. `TimelineSystem.updateKeyframe` dead no-op branch (former
     `plate.motion` sync) — remove.
  3. `parseImportFile` version-rejection untested end-to-end — add the
     jsdom `FileReader` test (`// @vitest-environment jsdom` on that
     file only).
  4. `npm audit`: 24 vulnerabilities recorded, mostly electron/builder
     transitive — **report-only pass**: classify which are dev-only,
     which touch the shipped renderer; recommend; do NOT bump majors in
     this brief.

## Work items

1. Execute TASK_18: unit tests for SplitTool (split-line trimming,
   longest-segment selection, side determination, L-rift arm assignment —
   the Technical Appendix in DEVELOPER_README.md names the heuristics,
   each gets a case), FusionTool (fresh motion model on the fused plate —
   the spread-clone regression class), BoundarySystem (if BRIEF_02 landed
   its tests, extend, don't duplicate), SimulationEngine derivation
   (isochron recording cadence, ring count stability over 100 steps — the
   accumulation test from the triple-junction checklist).
2. Execute TASK_19: vitest coverage in CI, gate ≥15% lines, badge
   optional. Typecheck + lint + test + build all in the workflow.
3. Known-defect sweep (items 1–3 fixed with regression tests; item 4
   report-only).
4. Wire `npm run verify` to match CI exactly (it already runs
   typecheck+test+build — confirm lint is either added to verify or to
   CI explicitly, currently they can diverge).

## Invariants and traps

- **Verify each recorded defect still exists before fixing** — the list
  is five days old and T4 touched adjacent code; fixing a fixed bug
  produces phantom diffs.
- SplitTool tests: the tool mutates app-level state in places — TASK_18
  prescribes the extraction seams; do not refactor beyond what the task
  authorizes just to make testing easier.
- The 0.5° junction-drift limitation and the `isPointInPolygon`
  pole-approximation are *documented known limitations* — write
  characterization tests that pin current behavior with a comment, not
  fixes.
- Coverage gates fail closed on flaky tests — no timers, no randomness
  without seeds (`generateId` uses `Math.random`; tests that need stable
  ids must inject/stub).
- jsdom is a devDependency add — keep it out of `dependencies`.

## Decision log

- Coverage floor 15% lines (MASTER_PLAN's number) — a ratchet, not a
  target; raise the floor as briefs add tests, never lower.
- SpeedPresets fix direction: prefer deletion of the dead path over
  routing (less code beats more plumbing) — decided by what the caller
  audit finds.
- npm audit is report-only here; dependency major-bumps are their own
  future task with electron-builder smoke testing.
- Characterize-don't-fix for known geometric limitations.

## Acceptance criteria

- [ ] TASK_18's own checklist passes; new test files for the four systems
      with the named scenarios.
- [ ] CI runs lint + typecheck + tests + coverage gate + build; a PR
      dropping coverage below floor fails.
- [ ] Defects 1–3: fixed-or-deleted with a regression test each, or a
      written "no longer reproduces, here's why" note.
- [ ] Audit report delivered (classification table, recommendations).
- [ ] `npm run verify` + lint green locally AND the same set green in CI.

## Non-goals

- No dependency upgrades, no refactors beyond TASK_18's prescribed seams,
  no E2E/browser-automation harness (revisit when UI briefs settle), no
  coverage vanity beyond the floor.

## Authority boundaries

No commits without user go-ahead. CI workflow changes affect the repo's
public checks — flag the diff explicitly in the report. If TASK_18's
extraction seams conflict with current SplitTool code (it moved since
2026-07-05), stop and reconcile the task brief first, in writing.

## Report format

Coverage before → after; test inventory (file → scenarios); per-defect
outcome table (reproduced? fixed/deleted/characterized? test name); audit
classification table; out-of-scope findings →
`docs/restructure-tasks/out-of-scope-list`.
