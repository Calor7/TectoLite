# BRIEF_15 - Touch input foundation: pointer events and explicit editor actions

Release: v1.1.0 Mobile - Size: M - Requires BRIEF_13; may follow BRIEF_14

## Goal and why

The canvas uses mouse events, while core workflows rely on hover, wheel,
double-click, right-click, and Shift/Ctrl/Meta modifiers. A native shell can
display that UI, but a phone user cannot reliably finish a path, remove a point,
move a whole shape, multi-select, or hit a five-pixel edge.

This brief creates one pointer-input pipeline for mouse, pen, and touch; adds
deterministic pinch/pan behavior; enlarges coarse-pointer hit regions; and adds
visible replacements for every keyboard/right-click-only editor operation. Full
phone panel/layout design is a later brief.

## The map

- Event ownership: `src/canvas/CanvasManager.ts` `setupEventListeners()` and
  `handleMouse*()`.
- Tool protocol: `src/canvas/tools/InputTool.ts` and Selection, Placement, Path,
  and Edit tool implementations.
- View transforms: `CanvasManager.rotateView()`, `translateView()`, wheel zoom,
  and `src/canvas/ProjectionManager.ts`.
- Hit tests: `CanvasManager.hitTest()`, `findNearestBoundaryElement()`,
  `src/canvas/MotionGizmo.ts`, and EditTool.
- Desktop-only meanings: right-click in EditTool/PathInputTool, double-click and
  Enter in PathInputTool, modifier drag in EditTool, Shift selection in
  SelectionTool, and global hotkeys in `src/main.ts`.
- Action buttons/hints: `src/ui/AppTemplate.ts`, `src/main.ts`, `src/style.css`.

## Fixed interaction grammar

| Intent | Touch/pen behavior | Mouse compatibility |
| --- | --- | --- |
| Select/place point | One-finger tap | Left click |
| Tool-specific drag | One-finger drag on handle, vertex, or selected shape | Left drag |
| Rotate globe | One-finger drag with Rotate active | Existing Rotate tool |
| Translate view | One-finger drag with Move View; two-finger centroid drag from any tool | Existing Move View |
| Zoom | Two-finger pinch around centroid | Wheel remains |
| Finish path/split | Visible Done/Apply action | Double-click/Enter remain |
| Remove last point | Visible Undo Point action | Right-click/Backspace remain |
| Delete vertex | Visible Delete Vertex action | Right-click/Delete remain |
| Move whole geometry | Explicit Move Shape toggle | Modifier-drag remains |
| Multi-select | Explicit Multi-select toggle | Shift-click remains |

No required action depends on long-press, double-tap, hover, hardware keyboard,
or platform-specific gestures. Those may remain optional accelerators.

## Work items

1. **Define tool-level input.** Add `EditorPointerEvent` with pointer id/type,
   primary-button state, modifier snapshot, screen position, and original-event
   cancellation hooks. Tools no longer require `MouseEvent` to express intent;
   geographic position remains the existing separate argument.
2. **Replace canvas mouse listeners with pointer listeners.**
   - Use `pointerdown/move/up/cancel`, pointer capture, and lost-capture cleanup.
   - Retain wheel and keyboard as desktop accelerators.
   - Set `touch-action: none` only on the canvas surface so sheets/forms scroll.
   - Prevent iOS canvas callout/text selection without disabling accessibility
     elsewhere.
3. **Add a pure gesture state machine** in `src/canvas/input/` with tests.
   - One pointer follows the selected tool.
   - A second touch before a candidate tap commits cancels that tap and switches
     to camera gesture, preventing accidental points.
   - Pinch zoom anchors at the centroid and uses the existing scale clamps.
   - Two-finger centroid movement translates the view.
   - No twist-to-rotate in v1; it is undiscoverable and easy to trigger.
   - Cancel, background, or lost capture ends without half a history entry.
4. **Commit touch taps on pointer-up.** Placement/selection commits only if
   movement stays within a small CSS-pixel slop and no second pointer joined.
   Mouse timing may remain behavior-compatible.
5. **Add explicit contextual actions.** Provide a minimal action strip shown
   only when relevant: Done/Apply, Cancel, Undo Point, Delete Vertex, Move
   Shape, and Multi-select. Reuse existing commands; buttons contain no mutation
   logic. A later adaptive-layout brief will reposition/style the strip.
6. **Make hit testing pointer-aware.** Keep rendered geometry thin while coarse
   pointers use centralized invisible hit radii: vertex 14 CSS px, edge 18 px,
   feature/plume 24 px, motion-gizmo handle 22 px. Preserve current fine-pointer
   values. Test deterministic nearest-target choice when regions overlap.
7. **Replace hover-only information.** Fine-pointer hover remains, but every
   datum/action must also be reachable through selection or a focusable info
   control. Skip delayed canvas hover-tooltip work for coarse pointers.
8. **Physical-device sweep.** On the smallest required iPhone and API 29-class
   Android, run: select, draw polygon/line, edit/insert/delete vertex, split,
   link, fuse, drag target, motion gizmo, rotate, translate, pinch, scrub,
   undo/redo, cancel, and background mid-gesture.

## Invariants and traps

- A pointer sequence produces at most one history transaction. Camera gestures
  produce none.
- A second finger never places a point or selects an entity.
- Switching a candidate edit to two-finger camera control leaves no temporary
  geometry or dirty state.
- Do not synthesize MouseEvents from TouchEvents; Pointer Events are the stream.
- Visual size and hit size remain separate.
- Page zoom, pull-to-refresh, selection handles, and context callouts must not
  steal canvas gestures, while panels/forms retain native behavior.
- Mouse precision, right-click, wheel, and keyboard shortcuts must not regress.

## Decision log

- Pointer Events rather than parallel mouse/touch implementations.
- Explicit commands rather than hidden long-press/double-tap conventions.
- Tool mode owns one-finger drags; two fingers always translate/zoom camera.
- No twist or pressure-sensitive behavior in mobile v1.
- Minimal action strip now; full adaptive layout later.

## Acceptance criteria

- [ ] Canvas interaction uses pointer events and capture; no required tool path
      is implemented only through touch events or synthetic mouse events.
- [ ] Every table action is reachable without mouse or hardware keyboard.
- [ ] Pinch/two-finger translation works from every tool without points,
      selection, mutation, dirty state, or undo entries.
- [ ] Cancellation/background leaves no stuck drag, modifier, ghost, or temp
      geometry.
- [ ] Coarse hit regions are centralized and preserve visual/fine precision.
- [ ] Tests cover tap slop, second-pointer takeover, pinch centroid/clamps,
      cancellation, and overlapping hit targets.
- [ ] Physical-device checklist is recorded with pass/fail.
- [ ] Mouse/keyboard smoke checklist and `npm run verify` pass.

## Non-goals

No final phone/tablet layout, native file handling, new tool semantics, stylus
pressure, haptics, Pencil hover, full accessibility audit, or simulation change.

## Authority boundaries

No gesture/UI framework may be added without user approval. If current mouse
semantics are ambiguous rather than merely inaccessible, record the product
decision needed instead of silently changing behavior.

## Report format

Interaction pass/fail per device; automated test inventory; mouse regression
checklist; gesture edge cases; files changed; verification commands. Append
unrelated findings to the out-of-scope list.
