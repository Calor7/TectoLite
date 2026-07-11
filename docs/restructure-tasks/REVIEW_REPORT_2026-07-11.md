# Restructure Review Report — 2026-07-11

> Forensic review per `.agent/skills/peripheral-vision/references/review.md`.
> Branch: `Automatation-3rd-try` · HEAD: `0eab301`

## Ground Truth (established before reading claims)

- **git status**: clean working tree; only untracked `.agent/` directory (skill files, not source).
- **git log** (last 10):
  ```
  0eab301 Add project templates for Modern Earth and Pangaea
  d60657c Add new project / clear world feature
  9c5328a Reset EventSystem on state boundaries
  f121318 Refactor callbacks and dependencies to interface-based objects
  41ec38a Complete TASK_07-10: perf harness, dirty render, caching
  5caf092 Add performance monitoring and benchmark world
  a94e24e Add roadmap and v0.2–v0.4 release briefs
  26cc057 T4 Redesign
  4215f16 T3 Redesign
  3decfb6 Next Steps Plan
  ```
- **git diff --stat**: no uncommitted changes to tracked files.

## Gate Results (run personally)

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | ✅ Pass (no output = no errors) |
| Tests | `npx vitest run` | ✅ Pass — 7 files, 81 tests, 0 failures |
| Production build | `npx vite build` | ✅ Pass — 278 modules, built in 1.14s |

## Task Status Summary

### Completed (Phase 0–3) — verified by spot-check

| Phase | Tasks | MASTER_PLAN claim | Spot-check verification |
|---|---|---|---|
| 0 | TASK_01, TASK_02 | Done in `4215f16` | ✅ `grep CausalGraph\|GeologicalAutomation src/**` → 0 matches |
| 1 | TASK_03–06 | Done in `4215f16`/`26cc057` | ✅ `isPointInPolygon` in `src/utils/sphericalMath.ts`; ✅ `CURRENT_SAVE_VERSION = 4` in `src/migration.ts` |
| 2 | TASK_07–10 | Done 2026-07-10 | ✅ `isDirty`/`markDirty`/`renderDirty` in `CanvasManager.ts` (31 matches) |
| 3 | TASK_11–12 | Done 2026-07-10 | ✅ `app: any` absent from `TimelineSystem.ts` and `CanvasManager.ts`; ✅ `_containerId`/`_simulationEngine`/`_historyManager` absent from `TimelineSystem.ts`; ✅ `eventSystem.reset()` called at 5 transition points in `main.ts` |

### Open / Not Started (Phase 4–7)

| Phase | Task | Title | Status |
|---|---|---|---|
| 4 | TASK_13 | Unify 7 modal code paths into one ModalManager | ❌ Open |
| 4 | TASK_14 | Extract inline styles to CSS classes | ❌ Open |
| 4 | TASK_15 | Adopt Preact + signals for properties panel (pilot) | ❌ Open |
| 5 | TASK_16 | Split `main.ts` god class into feature controllers | ❌ Open |
| 5 | TASK_17 | Replace `innerHTML` panel rebuilds with targeted DOM updates | ❌ Open |
| 6 | TASK_18 | Add tests for high-risk untested modules | ❌ Open |
| 6 | TASK_19 | Add CI workflow + coverage gate | ❌ Open |
| 7 | TASK_20 | Replace sql.js with lighter GeoPackage writer | ❌ Open |
| 7 | TASK_21 | Canvas2D → WebGL renderer | ❌ Open |
| 7 | TASK_22 | Fixed-timestep deterministic playback | ❌ Open |
| 7 | TASK_23 | Scene graph / retained rendering | ❌ Open |

**11 tasks remain open.** None of the task files (TASK_07–23) contain
inline completion markers — status is tracked solely in `MASTER_PLAN.md`.

## Findings

### Verified
- Phase 0–3 completions confirmed by independent grep probes against the
  codebase (not just trusting the MASTER_PLAN checklist).
- All three build gates pass cleanly.
- 81 tests pass across 7 test files.
- No `app: any` back-references in `TimelineSystem.ts` or
  `CanvasManager.ts` (TASK_11 acceptance criterion met).
- `eventSystem.reset()` present at 5 call sites in `main.ts` (TASK_12
  acceptance criterion met).

### Accepted on testimony
- MASTER_PLAN claim that Phase 0–1 was executed in commits `4215f16` /
  `26cc057` — not re-verified by reading those commits' diffs.
- Out-of-scope-list entries from TASK_03–06, TASK_12 — accepted as
  accurately recorded.

### Remaining for a human
- **Manual visual passes** for Phase 2 tasks (TASK_07–10): idle CPU usage,
  pan/zoom responsiveness, scrub smoothness, undo/redo correctness with
  10+ plates, memory comparison for 50-entry history.
- **Performance capture** for BRIEF_09 playback/scrub/undo scenarios
  (noted in out-of-scope-list: browser slider automation timed out).
- **Phase 4–7 execution**: 11 tasks remain open and require implementation.

### Backlog delta
- No new backlog entries from this review. Existing out-of-scope-list
  entries are comprehensive and accurately tracked.

## Verdict

**Phase 0–3 (TASK_01–12): COMPLETE and verified.** All three gates pass.
Spot-checks confirm the claimed work is present in the codebase.

**Phase 4–7 (TASK_13–23): OPEN.** 11 tasks remain to be implemented. These
are grouped into 4 phases with dependencies:
- Phase 4 (UI architecture) can start next — depends on Phase 3 (done).
- Phase 5 (structural) depends on Phase 3 + 4.
- Phase 6 (testing/CI) depends on Phase 1 + 3 (both done) — could run in
  parallel with Phase 4.
- Phase 7 (advanced) depends on Phase 2 + 5.

**Completion criteria from MASTER_PLAN**: all 23 tasks done, three verify
commands pass, no `app: any` back-references, no file > 800 lines (except
`types.ts`), test coverage ≥ 15%. Current state: 12/23 tasks done, gates
pass, `app: any` removed from key files, coverage ~5% (below 15% target —
TASK_18/19 needed).