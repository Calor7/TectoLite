# Plan: Advanced Motion Control Modes

## Objective
Implement two additional interaction modes for tectonic plate manipulation, enhancing the existing fixed Euler control.

## Status: COMPLETE

## 1. Architecture Updates (Done)
- **State Management**:
  - Added `interactionMode` to `AppState` or `CanvasManager` state.
  - Modes:
    1.  `'classic'` (Current): Fixed Euler Pole, adjust rate/direction along constrained arc.
    2.  `'dynamic_pole'` (New): Drag arrow freely; Euler pole moves to satisfy new velocity vector.
    3.  `'drag_target'` (New): Drag the plate geometry directly to a target position; calculates required motion based on user-provided target time.
- **UI**:
  - Added a mode switcher selector in the top toolbar.

## 2. Mode 2: Dynamic Euler Pole (Free Velocity) (Done)
- Implemented in `MotionGizmo.ts`.
- Updates Euler Pole based on `cross(PlateCenter, MousePosition)`.

## 3. Mode 3: Drag to Target (Drag & Time Input) (Done)
- **Workflow**:
  1.  User Selects "Drag Landmass" mode.
  2.  User drags plate to new visual position.
  3.  On Drop, system prompts: "Target Time (Ma)?".
  4.  User inputs time (e.g., Target > Current).
  5.  System calculates velocity required to move from Current Position to Dragged Position over the interval (Target - Current).
  6.  Adds/Updates Motion Keyframe at Current Time.
- **Implementation**:
  - `CanvasManager.ts`: Handles drag, `ghostRotation` visualization, and calling `onDragTargetRequest` on drop.
  - `main.ts`: Implements prompt logic, calculation (`Rate = Angle / dt`), and state update.
