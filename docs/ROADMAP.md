# TectoLite Roadmap

Status: **active — source of truth for product direction**
Authored: 2026-07-10 (lead-dev takeover review)
Companion briefs: [docs/briefs/](briefs/) (BRIEF_01 … BRIEF_10)
Companion tech-debt plan: [docs/restructure-tasks/MASTER_PLAN.md](restructure-tasks/MASTER_PLAN.md)

---

## 1. What TectoLite is

**The sketchbook for planetary history.** The fastest way to go from a blank
sphere to a plausible world with a geological story — for worldbuilders,
mapmakers, and teachers who want GPlates-grade ideas without GPlates-grade
friction. The user is the mantle: they author plate motion directly, and the
tool does the bookkeeping (spreading, boundaries, history, exports) correctly
and instantly.

### Product pillars

1. **Author-first, physics-lite.** Direct manipulation (draw, drag, split,
   fuse) is the primary interface. Simulation *derives consequences* from
   authored motion; it never takes the pen out of the user's hand. Automation
   is opt-in, always.
2. **Derived, not stored.** The architectural through-line that already won
   twice (isochron oceans, keyframe-less motion): persistent state is the
   *cause* (motion segments, geometry stages, isochrons); everything visible
   is *derived per frame*. New mechanics must follow this rule — it is what
   makes retroactive editing, scrubbing, and undo correct by construction.
3. **The timeline is the document.** A TectoLite file is not a map, it is a
   *history*. Editing the past must be as natural as editing geometry, and
   must propagate correctly.
4. **Every session ends in a map.** Exports (PNG, heightmap, GeoPackage,
   save file) are first-class outputs, not afterthoughts. A worldbuilder
   should leave every session with something usable in the next tool.
5. **It stays light.** Vanilla TS + Vite, canvas 2D until measurements say
   otherwise, no mesh runtime, no GPU simulation, file sizes a hobbyist's
   laptop laughs at.

### Scope fences (what TectoLite is NOT)

- **No mesh/GPU terrain simulation.** The mesh elevation runtime stays
  removed. Elevation is a *raster export concern* (see BRIEF_05), not a
  runtime system.
- **No erosion / climate / biome simulation.** That belongs to downstream
  tools; we make sure our exports feed them well.
- **No multiplayer / cloud.** Local files, local autosave.
- **No framework rewrite.** TASK_15 (Preact signals) stays a fenced *pilot*
  on one panel; it graduates only if the pilot demonstrably reduces panel
  bug rate.
- **WebGL is evidence-gated.** TASK_21/23 stay parked until the benchmark
  harness (BRIEF_09) shows a representative world under 30 fps *after* the
  cheap optimizations land.
- **New visual overlays and automation default OFF** (`=== true` checks,
  View/Settings toggles) — standing convention, no exceptions.

---

## 2. Where we are (honest assessment, 2026-07-10)

**Strengths**

- Motion model v4 (keyframe-less: `motionSegments` + `geometryStages`) is
  **complete and green** — 76 tests, typecheck, build all pass. This was the
  hardest structural problem in the codebase and it is done.
- Isochron-derived ocean crust + triple-junction wedges are merged and follow
  the derived-not-stored rule; retroactive motion edits no longer corrupt
  oceans by construction.
- Save-version migration layer exists (`src/migration.ts`,
  `CURRENT_SAVE_VERSION = 4`); old saves lazy-migrate on import.
- Restructure phases 0–1 (TASK_01–06) are executed: dead code gone
  (CausalGraph, GeologicalAutomation), docs de-lied, shared geometry
  extracted, deps sorted.
- CI exists (`.github/workflows/build.yml`), ESLint is wired, tooling is
  healthy.

**Gaps**

- **Unreleased foundation.** All of the above sits on branch
  `Automatation-3rd-try`, 8 commits ahead of `main` (clean fast-forward).
  The motion-model rewrite has *never had its manual visual pass*. Sixteen
  local branches linger. → BRIEF_01.
- **The crust lifecycle is half-built.** Divergence *creates* ocean crust;
  nothing *destroys* it. Convergence classification works
  (`BoundarySystem.ts`, threshold already calibrated to ~0.3 cm/yr) but has
  no geometric consequence. Worlds silently fill with overlapping ocean.
  → BRIEF_02, BRIEF_04.
- **Exports don't read as terrain.** The heightmap renders flat 120-gray
  continents plus feature dots (`HeightmapGenerator.ts:48–80`), ignoring
  seafloor age, orogeny, trenches, and `polygonType`. → BRIEF_03, BRIEF_05.
- **UI information architecture drifted.** Brand links inline in the title
  bar, 9 header buttons, Settings/View split leaking implementation detail,
  7 modal code paths, inline styles everywhere. → BRIEF_06.
- **Cold-start experience is a blank sphere.** No example worlds, tutorial
  content risks drifting from the current UI. → BRIEF_07.
- **The timeline panel is a read-mostly list** while the data model
  underneath finally supports true history editing. → BRIEF_08.
- **Performance is unmeasured.** Full redraw every frame, whole-world
  `structuredClone` per undo step, per-frame plate derivation with no
  memoization. Probably fine today, unknown at 100 plates × 500 Ma.
  → BRIEF_09.
- **Coverage is thin where risk is thickest.** SplitTool (~1,400 lines),
  FusionTool, BoundarySystem, SimulationEngine have little to no direct
  test coverage; a few known small defects are on record. → BRIEF_10.

---

## 3. Release plan

One brief = one session = one reviewable diff. Within a release, briefs are
ordered but independent; never run two briefs concurrently in one working
tree.

### v0.2.0 — "Foundation" (now)

Ship what is already built. No new features until the foundation is on
`main`, visually verified, and tagged.

| Brief | Title | Size |
|---|---|---|
| [BRIEF_01](briefs/BRIEF_01_ship_v0_2.md) | Visual QA pass, bookkeeping, release cut | S (human-in-loop) |
| [BRIEF_10](briefs/BRIEF_10_correctness_hardening.md) | High-risk tests, CI coverage gate, known-bug sweep | M (can start in parallel with v0.3 work) |

### v0.3.0 — "Living Oceans" (next)

Close the crust lifecycle and make the ocean tell its story. This is the
release where TectoLite's mechanics become *coherent*: create → move →
destroy, and every stage visible and exportable.

| Brief | Title | Size |
|---|---|---|
| [BRIEF_02](briefs/BRIEF_02_boundary_interaction_rules.md) | Boundary classification v2 (local edge normals, crust pairings) | S |
| [BRIEF_03](briefs/BRIEF_03_seafloor_age_visualization.md) | Seafloor age visualization (isochron age ramp) | S |
| [BRIEF_04](briefs/BRIEF_04_subduction_v1.md) | Subduction v1 — convergent boundaries consume oceanic crust | L |
| [BRIEF_05](briefs/BRIEF_05_heightmap_v2.md) | Heightmap v2 — boundary-aware relief, age-depth oceans | M |

### v0.4.0 — "The Author's Cut" (after)

Sharpen the authoring experience: first impressions, information
architecture, and true history editing.

| Brief | Title | Size |
|---|---|---|
| [BRIEF_06](briefs/BRIEF_06_ui_information_architecture.md) | UI information architecture + modal unification | M |
| [BRIEF_07](briefs/BRIEF_07_first_run_experience.md) | Example worlds + welcome flow + tutorial refresh | M |
| [BRIEF_08](briefs/BRIEF_08_timeline_v2.md) | Timeline v2 — the history editor | L |

### Continuous (no release gate)

| Brief | Title |
|---|---|
| [BRIEF_09](briefs/BRIEF_09_performance_program.md) | Benchmark harness, then TASK_07→08→09→10 in order |
| [BRIEF_10](briefs/BRIEF_10_correctness_hardening.md) | Ongoing coverage growth alongside feature work |

### Later / parked (ideas with a reason to wait)

Approved additions (2026-07-10):

- **New Project / Clear World** — approved; first blank-world slice implemented,
  with example templates to join BRIEF_07.
- **Manual geological event tool** — approved; build on EventSystem's existing
  placeholder after the event inspector establishes the authoring vocabulary.
- **Event history inspector** — approved; fold into BRIEF_08's history editor so
  detected interactions and chosen consequences share one timeline surface.
- **Project templates** — approved; fold into BRIEF_07's bundled example-world and
  welcome-flow work.

- **Animation export** (PNG sequence / WebM of timeline playback) — high
  worldbuilder value; wants deterministic stepping (TASK_22) first so
  exports are reproducible. Candidate headline for v0.5.
- **Ocean–ocean subduction** (older ring subducts, island arcs) — needs
  BRIEF_04's clip infrastructure plus ring-age comparison.
- **GPlates interop** (.rot export of motion segments) — niche; revisit on
  user demand.
- **Preact pilot (TASK_15), main.ts split (TASK_16/17), sql.js replacement
  (TASK_20), WebGL/scene graph (TASK_21/23), deterministic playback
  (TASK_22)** — see MASTER_PLAN; the fence decisions there stand, execution
  is sequenced behind the briefs above.

---

## 4. How the existing restructure plan maps in

The 23-task restructure plan remains valid; this roadmap *sequences* it
rather than replacing it:

- TASK_01–06 — **done** (commits `4215f16` "T3 Redesign", `26cc057` "T4
  Redesign"; status table updated in MASTER_PLAN).
- TASK_07–10 (performance) — absorbed by **BRIEF_09** (adds the measurement
  harness the tasks lacked, fixes execution order).
- TASK_11–12 (decoupling) — unblocked, execute as written when convenient;
  BRIEF_06/08 touch the same files, so schedule before or after, not during.
- TASK_13 (modals) — absorbed by **BRIEF_06**.
- TASK_14 (inline styles) — follow-up to BRIEF_06, execute as written.
- TASK_18–19 (tests, CI gate) — absorbed by **BRIEF_10**.
- TASK_15–17, 20–23 — parked behind fences (see above).

---

## 5. Working agreements (unchanged, restated)

- `npm run verify` + `npm run lint` green before any "done" claim; canvas
  behavior additionally needs a stated manual visual checklist.
- New options wire all four points: template, handler, `syncUIToState`,
  persistence. Defaults OFF for visuals/automation.
- Retroactive correctness is non-negotiable: any new mechanic must survive
  "scrub backward, edit the past, scrub forward" without artifacts — if it
  can't, it must be derived (not stored) until it can.
- Save-shape changes bump `CURRENT_SAVE_VERSION` and get a migration step +
  test in `src/migration.ts` / `migration.test.ts`.
- Out-of-scope findings go to `docs/restructure-tasks/out-of-scope-list`,
  never silently fixed or dropped.
