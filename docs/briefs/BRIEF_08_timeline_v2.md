# BRIEF_08 — Timeline v2: the history editor

Release: v0.4.0 "The Author's Cut" · Size: L

## Goal and why

"The timeline is the document" is the pillar the keyframe-less migration
was built to enable: motion segments and geometry stages are now small,
pure, retimeable data instead of baked snapshots. But the UI hasn't caught
up — the right-panel "Event Timeline" is a read-mostly list, and editing
history means hunting through properties panels. The bottom time slider
shows no events at all.

Timeline v2 makes history directly manipulable: see every event on the
slider, click to jump, drag to retime, delete with confidence. This is the
authoring payoff of the entire motion-model investment.

## The map

- `src/systems/TimelineSystem.ts` — owns the event list (`buildEventList`,
  reading `motionSegments`/`geometryStages` via `ensureMotionModel`) and
  `updateKeyframe` (the existing retime/edit path — **read it first**; it
  already handles segment edits and historical-integrity pinning).
  TASK_11 (`docs/restructure-tasks/TASK_11_decouple_timeline_canvas.md`)
  formalizes its `app: any` interface — execute TASK_11 first if it hasn't
  landed; building v2 on `app: any` doubles the later cleanup.
- Bottom bar: `#time-slider` + time display in `src/ui/AppTemplate.ts`
  (534–558), handlers in `main.ts` / `src/ui/TimeControls.ts`.
- Event sources to visualize: per-plate `motionSegments[].time` (skip
  index 0 = birth), `geometryStages[].time` beyond birth ("Edit" events),
  `plate.birthTime`/`deathTime` (split/fusion/birth), `RiftAxis.birthTime`
  + state changes, committed `TectonicEvent.time`.
- Undo: `src/HistoryManager.ts` — every mutation below must be a single
  undoable step (imitate how existing timeline edits push history).
- Time-shift sibling pattern: merge-import in `src/importHelpers.ts`
  (`remapImportedWorld`) shifts every time field in the model — its field
  inventory is your checklist for what "retime" must touch when a *split*
  moves (axis birthTime, isochrons, junction history, features'
  `generatedAt`…).

## Work items

1. **Slider event markers.** Render tick marks on/above `#time-slider`
   (absolutely-positioned divs in the timeline bar — no canvas): color by
   kind (motion=accent, edit=green, split/birth=orange, committed
   event=red). Hover tooltip: "12 Ma — Gondwana: motion change". Click →
   `setTime(t)`. Toggle "Timeline Markers" in the View menu — **default
   ON** (exception to defaults-off, justified: it is core navigation, not
   canvas clutter; it lives outside the canvas).
2. **Interactive event list.** Upgrade the right-panel list: each row gets
   jump (click), retime (drag handle or ✎ opening a time input via
   ModalManager), delete (🗑 with confirm). Group rows per plate,
   collapsible, sorted by time.
3. **Retime semantics** (route ALL through `TimelineSystem`, one public
   method per kind):
   - Motion segment: change `segment.time`, keep segments sorted, clamp
     between neighbors ±ε, forbid moving across segment 0 (birth).
   - Geometry stage: same constraints; stage 0 immovable.
   - Split retime (plate birth): v1 = **forbid with a toast** explaining
     why ("splits anchor ocean history — delete and re-split instead").
     The importHelpers field inventory shows how many linked times a split
     drags along (axis, isochrons, junctions, children births, sibling
     assignments' `createdAt`); doing it correctly is its own brief.
   - Committed TectonicEvent: shift `time` + `effectStartTime`/`EndTime`
     by the same delta (EventEffectsProcessor reads these each tick).
4. **Delete semantics**: motion segment delete = neighbors extend
   (existing behavior in `updateKeyframe`'s delete path if present —
   probe); stage delete = geometry reverts to previous stage from that
   time; committed event delete = effects cease (EventEffectsProcessor
   must tolerate a vanished event — probe its lookup path).
5. **Refresh discipline**: after any mutation — `simulationEngine.setTime
   (currentTime)`, canvas render, panel + marker rebuild (grep the
   existing post-`updateKeyframe` sequence in `main.ts` and reuse it; do
   not invent a second refresh path).

## Invariants and traps

- **Segment/stage arrays are sorted by time and index 0 is birth** — every
  mutation preserves both or `plateRotation`/`derivePlateGeometry` return
  garbage silently.
- The spread-clone hazard (documented in memory + tests): never clone a
  plate without carrying `motionSegments`/`geometryStages` deliberately —
  retime mutates in place on a history-pushed copy instead.
- `TimelineSystem.buildEventList` calls `ensureMotionModel` as a safety
  net — keep that call; it is a no-op for healthy plates.
- Rift-axis isochrons are keyed to absolute times: retiming *motion* is
  safe (rings re-derive), but anything touching a split's time is the
  minefield — hence the v1 prohibition.
- Marker layer must not eat slider drag events (pointer-events
  management); markers update on every world mutation, so build them from
  one `collectTimelineEvents(world)` pure function you can unit-test.
- Multiple events at the same Ma must stack/offset visually, not overlap
  into one unclickable pixel.

## Decision log

- Slider markers default ON (navigation, not decoration) — documented
  exception to the defaults-off convention.
- Split retime is forbidden in v1, with an explanatory toast — honest
  limitation beats silent corruption.
- Drag-to-retime uses a modal time input on ✎ as the baseline
  implementation; literal dragging of rows is a stretch goal, not
  acceptance criteria (drag UX on a dense list is easy to get wrong).
- All mutations flow through TimelineSystem public methods — main.ts gets
  thinner, not thicker.

## Acceptance criteria

- [ ] Markers appear for every event kind; click jumps; tooltip correct;
      toggle hides them.
- [ ] Retime a motion change later → replay shows the course change at
      the new time; undo restores; save/reload preserves.
- [ ] Retime an Edit stage → geometry switches at the new time, before it
      shows the prior stage.
- [ ] Delete a committed event → its features/effects stop applying;
      undo brings them back.
- [ ] Split rows show retime disabled with the explanatory toast.
- [ ] `collectTimelineEvents` unit tests green; `npm run verify` + lint
      green; manual visual checklist supplied (marker density, drag focus,
      panel grouping).

## Non-goals

- No split/fusion retiming, no per-plate horizontal swimlane view (parked
  idea), no keyframe curve editing, no changes to EventSystem detection,
  no drag-on-slider event *creation*.

## Authority boundaries

No commits without user go-ahead. If `updateKeyframe`'s existing semantics
conflict with the retime rules above (e.g. it already allows crossing
neighbors), stop and report the discrepancy before changing behavior users
may rely on.

## Report format

Files changed; the retime/delete semantics table as implemented; probe
results for the two "probe" items (delete path, EventEffectsProcessor
tolerance); manual visual checklist; out-of-scope findings →
`docs/restructure-tasks/out-of-scope-list`.
