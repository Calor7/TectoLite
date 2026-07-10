# BRIEF_09 — Performance program: measure first, then TASK_07→08→09→10

Release: continuous · Size: M (harness) + the four existing tasks

## Goal and why

Every mechanic this roadmap adds (derived rings, junction wedges,
subduction clipping, age ramps, boundary classification) is per-frame
work, and the pipeline already redraws everything unconditionally and
`structuredClone`s the whole world on every undo push. Nobody has
numbers. The restructure plan has four approved performance tasks
(TASK_07 render-dirty flag, TASK_08 projection cache, TASK_09 memoize
plate derivation, TASK_10 structural-sharing history) but no way to prove
any of them helped — and the WebGL fence (TASK_21/23) explicitly waits on
evidence.

This brief adds the missing instrument, then executes the four tasks in
order, each gated on measured improvement or an honest "no change" note.

## The map

- The four task briefs: `docs/restructure-tasks/TASK_07…TASK_10*.md` —
  they are already decision-complete implementation specs; **follow them
  as written**, this brief only wraps them in measurement.
- Render loop: `src/canvas/CanvasManager.ts` (render entry), sim loop:
  `src/SimulationEngine.ts` `update()`, history: `src/HistoryManager.ts`
  (`structuredClone` sites).
- Dev-only surface convention: nothing exists yet — add the perf readout
  behind a URL param (`?perf`) or localStorage flag, NOT a globalOptions
  toggle (it is a developer instrument, not a user setting, and must not
  enter save files).

## Work items

1. **Frame-time harness** (land before any optimization):
   - `src/utils/PerfMonitor.ts`: ring buffer of last 120 frame times +
     per-phase marks (`sim`, `derive`, `render`) via
     `performance.now()`; overlay readout (avg / p95 ms, plate count,
     ring count) drawn as a corner div when `?perf` is in the URL.
   - **Benchmark world**: a deterministic generator function (not a saved
     file — code can't drift) `makeBenchmarkWorld(scale)` in
     `src/utils/benchmarkWorld.ts`: `scale=1` ≈ 30 plates, 4 active rifts,
     linked chains, 200 Ma of segments; `scale=3` for stress. Loadable via
     `?perf=bench1`.
   - Record baseline numbers (idle, playback, scrub) in
     `docs/PERF_BASELINE.md` — table per scenario, machine noted.
2. **Execute TASK_07 (dirty flag)** — expected win: idle CPU ≈ 0.
   Measure idle frames before/after.
3. **Execute TASK_08 (projection cache)** — measure scrub + playback.
4. **Execute TASK_09 (memoize `calculatePlateAtTime`)** — measure
   playback with linked-chain plates (the worst case: parent chains
   recompute per child per frame).
5. **Execute TASK_10 (structural-sharing history)** — measure undo-push
   time and heap growth on bench1 after 50 edits (DevTools heap snapshot
   or `performance.memory` where available; note method).
6. Update `docs/PERF_BASELINE.md` after each task: same table, new
   column. Close with a verdict line for the WebGL fence: met / not met
   (< 30 fps on bench1 after all four = fence opens).

## Invariants and traps

- **One task per session/diff**, verify green between each — these touch
  the hottest paths in the app; a combined diff is unreviewable and
  unbisectable.
- Dirty-flag (TASK_07) danger: every state mutation site must set the
  flag — the task brief lists the known sites; the failure mode is a
  *stale canvas* after some rare mutation. Manual pass after: run every
  tool once, undo/redo, import, scrub — screen must never show stale
  state.
- Memoization (TASK_09) danger: cache invalidation on retroactive edits —
  key by (plateId, time, motion-model identity); the motion model changes
  identity on every timeline edit. If TASK_09's brief predates the
  keyframe-less flag day (it may reference keyframes), adapt the *keying*
  to segments/stages and note the divergence in the report.
- Structural sharing (TASK_10) danger: the spread-clone hazard memory —
  shared plate objects must be treated as frozen; any in-place mutation
  after sharing corrupts history. The task brief's copy-on-write rules
  are the contract; add a dev-mode `Object.freeze` on shared plates in
  the history stack to make violations throw early.
- PerfMonitor itself must cost ~nothing when off (single `if` per frame).
- Do not tune anything the harness doesn't show as hot — no speculative
  micro-optimizations; the diff budget belongs to the four tasks.

## Decision log

- Harness before optimizations — non-negotiable ordering; unmeasured
  optimization PRs will be declined.
- Benchmark world is generated code, not a fixture file (fixtures rot
  with save versions; the generator migrates with the types).
- `?perf` URL param, dev-only, never persisted, never in save files.
- Execution order 07→08→09→10 (cheapest/safest first; 10 is the riskiest
  and benefits from the stability the others buy).

## Acceptance criteria

- [ ] `?perf` overlay shows live frame stats; `?perf=bench1` loads the
      benchmark world.
- [ ] `docs/PERF_BASELINE.md` has baseline + one column per completed
      task, same scenarios, honest numbers (including any regressions).
- [ ] Each task's own acceptance criteria (in its TASK file) pass.
- [ ] After TASK_07: idle (no interaction, not playing) draws no frames.
- [ ] After all four: bench1 playback p95 frame time improved vs baseline,
      number stated; WebGL fence verdict written.
- [ ] `npm run verify` + lint green after EACH task, plus the stale-canvas
      manual sweep after TASK_07.

## Non-goals

- No WebGL, no scene graph, no OffscreenCanvas/workers, no changes to
  simulation semantics, no optimization of code the harness doesn't
  indict.

## Authority boundaries

No commits without user go-ahead; each task is its own commit candidate.
If a task's measured result is a regression or a wash, keep the diff
shelved, report, and move to the next — do not "fix it forward" past the
task's own scope.

## Report format

Per task: the PERF_BASELINE table delta, files changed, task acceptance
checklist, and the stale-canvas sweep result (TASK_07). Final: fence
verdict; out-of-scope findings →
`docs/restructure-tasks/out-of-scope-list`.
