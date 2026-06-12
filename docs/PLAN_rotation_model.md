# Plan: Keyframe-less Motion Model (Rotation Tree)

Branch: `Test-keyframe-less`

## Problem

Today a plate's history is stored as `motionKeyframes`, where every keyframe carries
**baked copies of the geometry** (`snapshotPolygons`, `snapshotFeatures`). Position at
time t = active keyframe's snapshot + rotation since that keyframe. Correctness of any
retroactive edit therefore depends on re-baking every downstream snapshot, across every
descendant plate, in the right order (`recalculateMotionHistory`, `triggerUpdate`).

Documented consequences (see memory/audits):
- Retroactive motion edits don't propagate to grandchildren (gap 1, patched) and can't
  propagate into child `initialPolygons` at all (gap 2).
- Two snapshot-baking paths disagree: live keyframe creation snapshots *rendered* state
  (incl. inherited motion); `recalculateMotionHistory` rebuilds from own poles only
  (gap 3 — "plates jump after timeline edits").
- Save files and undo clones duplicate full geometry per keyframe per plate.

The isochron ocean system already uses the target architecture (absolute coordinates at
creation time + advection via composed rotations) and is immune to all of the above.

## Target model

A plate stores **no derived geometry**. Two new arrays:

```ts
/** Piecewise-constant motion: pole active from `time` until the next segment. */
interface MotionSegment { time: number; eulerPole: EulerPole; }

/** Geometry definition valid from `time` (birth, or a shape edit), in absolute
 *  coordinates at `time`. Replaces snapshots AND initialPolygons/initialFeatures. */
interface GeometryStage { time: number; polygons: Polygon[]; features: Feature[]; }
```

Derivation (pure functions, no caching of results in state):

```
rotation(plate, t0, t1)   = piecewise composition of segments (quaternions),
                            pre-birth delegated to parentPlateId,
                            linked motion composed from the link chain within
                            [linkTime, unlinkTime), own axis carried by parent rotation
plateAtTime(plate, t)     = activeStage(t).geometry rotated by rotation(stage.time → t)
featureAt(f, t)           = f.position (absolute at f.generatedAt) rotated by
                            rotation(generatedAt → t)
```

Properties: retroactive edits are correct by construction; children/grandchildren need
no re-baking ever; `recalculateMotionHistory`, `TimelineSystem.triggerUpdate` re-bake,
and `applyPlateMotion` all collapse into one rotation function; saves shrink.

## Phases

| Phase | Status | Deliverable | Verifiable by |
|---|---|---|---|
| 1 | ✅ done | `src/motion/RotationModel.ts`: pure core (segments→quaternion, parent chain, stage derivation) + `fromLegacyKeyframes` converter + 20 unit tests incl. golden scenarios (multi-segment, split inheritance, retroactive edit, edit-stage) | vitest |
| 2 | ✅ done | Engine consumes core: `calculatePlateAtTime` + `applyPlateMotion` re-implemented on top of it (signatures kept, −183 lines), legacy keyframes auto-converted via `getMotionModel`; `recalculateMotionHistory` is now an identity (no more rebaking, no more Edit-snapshot destruction) | vitest + typecheck — **needs visual pass** |
| 3 | ✅ done | Producers + timeline on the new model: `addMotionKeyframe` writes `motionSegments` (old-pole pinning preserved); shape edits append/replace `geometryStages`; 'Apply at Generation' un-rotates through the full model; SplitTool baking delegates to the core (−176 lines, per-feature anchoring fixed); TimelineSystem lists/edits/retimes/deletes segments & stages via `ensureMotionModel` (materializes legacy keyframes once, then clears them — no split-brain) | typecheck + tests |
| 4 | ✅ done | SAVE_VERSION 2: plates serialize `motionSegments`/`geometryStages` (incl. from_current_time time-shifting); merge-import remaps/shifts the new fields; v1 files migrate lazily via `fromLegacyKeyframes` on first touch | typecheck + tests |
| 5 | ✅ effective | No rebaking exists (`recalculateMotionHistory` = identity; triggerUpdate walk now harmless). Deliberately KEPT: `MotionKeyframe` type + snapshot fields (required to parse v1 saves), draw/split/fusion still create one initial legacy keyframe (materialized on first timeline touch — converter is the permanent v1 path) | typecheck |

### Full-implementation status (2026-06-12)

The model is functionally complete end to end: create → move → edit → split → fuse →
timeline-edit → save(v2) → load all run on derived geometry. Remaining niceties, not
blockers: draw/split/fusion could write segments/stages directly at creation (currently
one legacy keyframe each, converted on first touch); `ensureMotionModel` unit tests.

### Phase 2 behavioral notes (visual checklist)

- Linked plates: inherited motion now applies over the whole link window instead of
  resetting at each child keyframe (the gap-3 fix). Worlds using Link + own motion on
  the same plate may render slightly differently — the new behavior is the correct one.
- 'Edit' keyframes survive timeline edits now (legacy rebake used to overwrite their
  snapshots with rotated birth geometry — gap 2's worst symptom).
- Producers still write legacy keyframes; the converter consumes them each frame.
  Perf is fine at current scale (conversion is O(keyframes) per plate per frame).

## UI implications (thought through, mostly invisible)

- **Timeline panel**: items currently come from `motionKeyframes` (label/rate) — will map
  1:1 to `motionSegments` ("Motion Change") and `geometryStages[1..]` ("Shape Edit").
  Editing a segment's rate/pole in the panel no longer triggers any re-bake — just a render.
- **Apply Edit modal** maps directly: "Apply at Generation" = replace stage 0 geometry
  (re-anchored to birth via inverse rotation); "Insert Event" = append a stage at
  currentTime with the live-edited geometry (already absolute at currentTime).
- **Properties panel / speed inputs / gizmo**: read & write the *latest* segment ≤ t —
  same UX, simpler code.
- **Rendering**: unchanged — the canvas keeps consuming the derived plate object.
- **Undo**: unchanged initially (full clones get cheaper because state shrinks).
- **Export PNG/GeoPackage**: consume derived `plate.polygons` — unchanged.

## Risks / mitigations

- Linked-motion semantics differ subtly between the two legacy code paths (gap 3); the
  core implements ONE documented composition and tests pin it. Legacy conversion uses
  own-pole segments only (matching `recalculateMotionHistory`), which is the
  deterministic interpretation.
- Feature inheritance on split is entangled with snapshots; phase 3 moves it to
  stage-construction time (children copy parent features inside their boundary into
  their birth stage) — simpler and testable.
- Old saves: migrated on import, never written back in v1 form.
- Visual verification is required before merging this branch back to main; phases 2+
  keep `npm run verify` green but canvas behavior needs a human pass per phase.
