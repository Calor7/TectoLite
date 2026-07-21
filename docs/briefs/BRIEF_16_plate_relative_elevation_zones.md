# BRIEF 16 — Plate-relative elevation zones

Status: future / approved concept

## Outcome

Let users paint altitude changes onto plates, landmasses, or polygons and have
those changes travel with the owning geometry through geological time.

## Authoring model

- A zone belongs to one entity and is stored in that entity's plate-relative
  coordinate frame at the edit time.
- The brush adds or subtracts elevation rather than replacing the whole map.
- Hard mode affects only the brush footprint and preserves a sharp boundary.
- Soft mode uses a configurable falloff so neighboring samples blend toward
  the untouched elevation.
- Users can raise, lower, smooth, erase, hide, group, and recolor authored
  zones; locking the owner prevents edits.
- Polygon fill is available for exact plateaus/basins in addition to a brush.

## Architecture constraints

- Store authored causes (strokes/zones and their owner/time), then derive the
  current elevation field. Do not bake a new world raster on every timeline
  tick.
- Transform samples with the same plate motion model used by attached labels
  and features.
- Composite overlapping zones deterministically in explicit layer order.
- Keep runtime visualization lightweight; the full-resolution result remains
  a heightmap/export concern rather than a persistent terrain mesh.
- Define behavior for split and fusion before implementation: zones should be
  clipped/reparented during geometry changes, never silently duplicated.

## Suggested delivery slices

1. Data model, save migration, hard circular brush, undo/redo, and heightmap
   export integration.
2. Soft falloff profiles, smoothing, pressure/strength controls, and live
   low-resolution preview.
3. Polygon fill, split/fusion transfer rules, and performance validation on
   long timelines.

## Acceptance questions for implementation planning

- Is elevation additive, absolute, or selectable per zone?
- Should soft falloff be linear, smoothstep, Gaussian, or user-selectable?
- How are zones clipped and reassigned when a plate splits or fuses?
- What resolution is sufficient for editing preview versus final export?
