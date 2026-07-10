# TectoLite Restructure — Master Plan

> **Sequencing note (2026-07-10):** product direction and task sequencing now live in
> [docs/ROADMAP.md](../ROADMAP.md). This plan remains the source of truth for the
> individual TASK_XX specs; the roadmap says when (and inside which brief) they run.
> Absorptions: TASK_07–10 → BRIEF_09 · TASK_13 → BRIEF_06 · TASK_18–19 → BRIEF_10.

## Goal
Execute all 18 approved recommendations + 8 approved fence-item decisions from the architectural review (2026-07-05). Each task is a self-contained `TASK_XX.md` file in this directory, designed to be executed independently by a subagent from an empty chat.

## Execution Order (Phases)

Tasks are grouped into phases. Within a phase, tasks can run in parallel. Across phases, later phases depend on earlier ones. **Execute in phase order.**

### Phase 0 — Cleanup & Removal (no dependencies, safe first)
- [TASK_01](TASK_01_delete_dead_code.md) — Delete `GeologicalAutomation.ts` + remove `CausalGraph` (fence #5: remove)
- [TASK_02](TASK_02_fix_misleading_docs.md) — Fix/remove misleading docs, update README

### Phase 1 — Foundation (low-risk, enables later phases)
- [TASK_03](TASK_03_extract_shared_geometry.md) — Extract `isPointInPolygon` + shared geometry utils
- [TASK_04](TASK_04_move_types_to_devdeps.md) — Move `@types/*` to devDependencies
- [TASK_05](TASK_05_finish_motion_migration.md) — Finish motion model migration (flag day, remove legacy fields)
- [TASK_06](TASK_06_save_version_migration.md) — Add save-version migration layer

### Phase 2 — Performance (independent, high value)
- [TASK_07](TASK_07_render_dirty_flag.md) — Add render-dirty flag to CanvasManager
- [TASK_08](TASK_08_cache_projection.md) — Cache projection in ProjectionManager
- [TASK_09](TASK_09_memoize_plate_derivation.md) — Memoize `calculatePlateAtTime`
- [TASK_10](TASK_10_structural_sharing_history.md) — Replace structuredClone history with structural sharing (fence #7)

### Phase 3 — Decoupling (enables Phase 4)
- [TASK_11](TASK_11_decouple_timeline_canvas.md) — Decouple TimelineSystem + CanvasManager from `app: any` (formalize interfaces)
- [TASK_12](TASK_12_consolidate_event_system_state.md) — Consolidate EventSystem singleton state + clearCache on new-project/import

### Phase 4 — UI Architecture (depends on Phase 3)
- [TASK_13](TASK_13_unify_modals.md) — Unify 7 modal code paths into one ModalManager
- [TASK_14](TASK_14_extract_inline_styles.md) — Extract inline styles to CSS classes
- [TASK_15](TASK_15_adopt_preact_signals.md) — Adopt Preact + signals for properties panel (fence #1) — **PILOT: properties panel only first**

### Phase 5 — Structural (depends on Phase 3, 4)
- [TASK_16](TASK_16_split_main_ts.md) — Split `main.ts` god class into feature controllers
- [TASK_17](TASK_17_replace_innerhtml_panels.md) — Replace `innerHTML` panel rebuilds with targeted DOM updates (or Preact from TASK_15)

### Phase 6 — Testing & CI (depends on Phase 1, 3)
- [TASK_18](TASK_18_add_tests_high_risk.md) — Add tests for SplitTool, BoundarySystem, SimulationEngine, FusionTool
- [TASK_19](TASK_19_add_ci_coverage.md) — Add CI workflow + coverage gate

### Phase 7 — Advanced (fence items, depends on Phase 2, 5)
- [TASK_20](TASK_20_replace_sqljs.md) — Replace sql.js with lighter GeoPackage writer (fence #2)
- [TASK_21](TASK_21_webgl_renderer.md) — Canvas2D → WebGL renderer (fence #3)
- [TASK_22](TASK_22_deterministic_playback.md) — Fixed-timestep deterministic playback (fence #4)
- [TASK_23](TASK_23_scene_graph_retained.md) — Scene graph / retained rendering (fence #8)

## Approved Fence Decisions
1. ✅ Adopt Preact + signals (pilot: properties panel first) → TASK_15
2. ✅ Replace sql.js with lighter writer → TASK_20
3. ✅ Canvas2D → WebGL → TASK_21
4. ✅ Deterministic playback → TASK_22
5. ✅ Remove CausalGraph entirely → TASK_01
6. ✅ Keep Boundary.type and LineType separate (approved, no action — documented in TASK_03)
7. ✅ Structural sharing history → TASK_10
8. ✅ Scene graph / retained rendering → TASK_23

## Review Protocol
After each task completes:
1. Run `npx tsc --noEmit` — must pass
2. Run `npx vitest run` — must pass (or update tests if intentional)
3. Run `npx vite build` — must pass
4. Review the diff for architectural consistency
5. Update this checklist: mark `[x]` when complete
6. Note out of scope findings and tasks and write them to docs\restructure-tasks\out-of-scope-list

## Completion Criteria
All 23 tasks complete, all three verify commands pass, no `app: any` back-references remain, no file > 800 lines (except `types.ts`), test coverage ≥ 15%.

## Status
- [x] Phase 0 (TASK_01, TASK_02) — executed in commit `4215f16` "T3 Redesign" (CausalGraph + GeologicalAutomation removed, docs corrected)
- [x] Phase 1 (TASK_03–06) — executed in commits `4215f16`/`26cc057` "T3/T4 Redesign" (shared geometry extracted, @types moved, motion flag-day done, `src/migration.ts` + SAVE_VERSION 4 added); follow-ups recorded in `out-of-scope-list`
- [x] Phase 2 (TASK_07–10) — executed 2026-07-10 (perf harness + `?perf=bench1`, dirty render loop, projection cache, plate derivation memoization, structural history snapshots); follow-ups recorded in `out-of-scope-list`
- [ ] Phase 3 (TASK_11, TASK_12)
- [ ] Phase 4 (TASK_13–15)
- [ ] Phase 5 (TASK_16, TASK_17)
- [ ] Phase 6 (TASK_18, TASK_19)
- [ ] Phase 7 (TASK_20–23)
