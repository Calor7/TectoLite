# Elevation System Status Note

Last reviewed: March 31, 2026

This document is preserved as historical planning context. It does not describe the current runtime accurately.

## Current reality

- The repository does not currently contain `src/systems/ElevationSystem.ts`.
- A mesh-editing elevation workflow is not wired into the active application runtime.
- `HeightmapGenerator.ts` is present and active for export-oriented raster generation.
- Some elevation-related language remains in types, comments, and older docs, but it should be treated as partial or historical unless verified directly in `src/`.

## What this means

- Do not use this file as the source of truth for active feature status.
- Treat the phase lists that used to live here as an earlier implementation plan rather than a current completion report.
- Any future elevation work should begin with a fresh architecture decision: either restore a real runtime elevation system or remove the stale references and keep elevation export-only.

## Historical plan summary

The earlier elevation plan aimed to cover:

1. Data model support for crust and elevation state.
2. A dedicated runtime elevation simulation system.
3. Integration into the simulation loop.
4. Visualization and editing tools.
5. UI polish and workflow integration.

That plan is not fully represented in the current codebase.

## Recommended next step for elevation work

Before implementing anything new, audit these files first:

- [src/types.ts](../src/types.ts)
- [src/main.ts](../src/main.ts)
- [src/canvas/CanvasManager.ts](../src/canvas/CanvasManager.ts)
- [src/SimulationEngine.ts](../src/SimulationEngine.ts)
- [src/systems/HeightmapGenerator.ts](../src/systems/HeightmapGenerator.ts)

Then choose one of two directions:

1. Reintroduce a real elevation runtime path and wire it end to end.
2. Officially retire the mesh-editing plan and document elevation as export-only.
