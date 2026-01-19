# TectoLite - Spherical Plate Tectonics Simulator

TectoLite has been updated to a fully spherical simulation engine using `d3-geo`.

## New Features

### 🌍 Spherical Earth Model
- **Real 3D Geometry**: Plates now move on a sphere using vector mathematics.
- **Projections**: Toggle between Orthographic (Globe), Mercator, Mollweide, Robinson, and Equirectangular views.
- **Navigation**: 
  - **Rotate Tool (H)**: Spin the globe in Orthographic view or pan in map views.
  - **Zoom**: Scroll to zoom in/out.

### ⚛️ Euler Pole Kinematics
- **Physics-based Motion**: Plate movement is defined by Euler Poles (Rotation Axis + Rate).
- **Interactive Control**:
  - Select a plate and use the Properties Panel to set the Euler Pole position (Lon/Lat) and Rate (degrees/Ma).
  - Toggle "Euler Poles" visibility to see the rotation axes on the globe.
- **Timeline-based Simulation**:
  - Motion is calculated functionally based on time.
  - **Scrub timeline** or click **Reset** to see past/future configurations.
  - **Non-destructive**: Resetting time perfectly restores original positions.

### ✂️ Temporal tools
- **Split Tool (S)**: 
  - Splitting a plate creates two new child plates at the current simulation time.
  - The parent plate "dies" at that time.
  - Scrubbing back in time reveals the original parent plate.
  - Scrubbing forward reveals the new child plates.

## Usage Guide

1.  **Select Projection**: Use the top-right dropdown to choose your preferred map view.
2.  **Draw Plate**: Use the **Draw Tool (D)** to click points on the globe. Double-click to finish.
3.  **Define Motion**:
    *   Select the plate.
    *   In the Properties Panel, set **Pole Rate** (e.g., 5.0).
    *   Adjust Pole Lon/Lat to change direction.
4.  **Simulate**: Click Play (Spacebar) or drag the timeline slider.
5.  **Split**: 
    *   Go to the time you want the split to happen.
    *   Use **Split Tool (S)** to draw a line across the plate.
    *   New plates are created from that moment forward.

## Technical Details

- **Engine**: Custom TypeScript SimulationEngine using functional kinematic state.
- **Rendering**: HTML5 Canvas + `d3-geo` paths.
- **Data Model**: `TectonicPlate` stores `initialPolygons` and `birthTime`. Current position is derived via quaternion/vector rotation at runtime.
