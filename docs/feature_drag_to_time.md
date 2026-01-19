# Feature: Drag to Time (Target Mode)

## Overview
Allows users to intuitively define tectonic plate motion by dragging the landmass to a desired future position and specifying the time of arrival.

## Workflow
1.  **Select Mode**: Choose "Drag Landmass" from the interaction mode dropdown.
2.  **Drag**: Click and drag any tectonic plate on the globe.
    *   A "ghost" of the plate follows the mouse, visualizing the rotation/translation.
3.  **Drop & Input**: Release the mouse button.
    *   A prompt appears: "Target Time (Ma)? (Current: [Time])".
4.  **Calculate**:
    *   User inputs a target time (e.g., 50 Ma).
    *   System calculates the Euler Pole and Rotation Rate required to move the plate from its *current* position to the *dragged* position over the duration `dt = TargetTime - CurrentTime`.
5.  **Result**:
    *   A new Motion Keyframe is added at `CurrentTime` with the calculated velocity.
    *   When the simulation runs effectively from Current -> Target, the plate will arrive at the dragged position at the target time.

## Technical Details
- **Rotation Calculation**: Uses the cross product of the start mouse vector and current mouse vector to determine the axis of rotation and angle (Great Circle path).
- **Velocity**: `Rate (deg/Ma) = DragAngle (deg) / (TargetTime - CurrentTime)`.
- **Euler Pole**: The rotation axis normalized becomes the Euler Pole position.
