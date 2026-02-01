# Plan: Boundary Interaction Logic Upgrade

## objective
Refine plate boundary classification (Convergent vs Divergent vs Transform) to robustly support Orogeny generation. Currently, the system biases heavily towards "Transform" due to incorrect velocity thresholds.

## Step 1: Calibrate Velocity Thresholds (Immediate Fix)
*   **Problem**: Current threshold for Convergence is `0.05` (assumed Radians/Ma).
    *   `0.05 rad/Ma` ≈ `32 cm/yr`.
    *   Real plate speeds are `1-10 cm/yr`.
    *   **Result**: All realistic collisions are below threshold and default to "Transform".
*   **Fix**:
    *   Lower threshold to `0.001` (~0.6 cm/yr).
    *   This will allow normal plate motions to register as Convergent/Divergent.

## Step 2: Refine Interaction Rules
*   **Convergent (> Threshold)**
    *   **Cont-Cont**: Mountain Belt (scattered along line).
    *   **Cont-Oce**: Continental Arc (Volcanoes on Cont side).
    *   **Oce-Oce**: Island Arc (Volcanoes on Overriding side).
*   **Divergent (< -Threshold)**
    *   **Rift Valley / Ridge**: Spawn new crust (or visual rift features).
*   **Transform (Between Thresholds)**
    *   **Shear Zone**: Low elevation changes, potential earthquake hotspots (visual only).

## Step 3: Geometry Heuristics (Future)
*   Instead of Centroid-to-Centroid vector (current), calculate the **Weighted Edge Normal** of the intersection polygon.
    *   *Reason*: Long, serpentine plates (like Chile/Andes) might have centroids far away that don't represent the local collision normal.
    *   *Implementation*: Average the normal vectors of the overlapping polygon segments.

## Step 4: Verification
*   User will drag plates to collide at ~5 cm/yr.
*   System must log "Convergent" type.
*   Mountains must spawn.
