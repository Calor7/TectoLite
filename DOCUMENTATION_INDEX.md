# TectoLite Documentation Index

Status: active living index
Last reviewed: March 31, 2026

This index reflects the current repository state. Older delivery documents remain useful as project history, but they should not be treated as the source of truth when they conflict with current code.

## Start here

### Current technical reference

- [DEVELOPER_README.md](DEVELOPER_README.md): current project structure, architecture notes, and development workflows.

### Product and workflow direction

- [README.md](README.md): UI norms, workflow direction, and high-level feature intent.

### Manual verification

- [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md): manual smoke and exploratory checks.

### Current elevation status

- [docs/ELEVATION_SYSTEM_PROGRESS.md](docs/ELEVATION_SYSTEM_PROGRESS.md): historical context for elevation work plus a note on current inactive runtime paths.

## Source of truth by area

### App shell and orchestration

- [src/main.ts](src/main.ts): main application wiring, properties panel logic, and DOM event binding.

### Rendering and tools

- [src/canvas/CanvasManager.ts](src/canvas/CanvasManager.ts): canvas rendering, tool registration, and view interaction.

### Simulation

- [src/SimulationEngine.ts](src/SimulationEngine.ts): time stepping, plate updates, and flowline or event-effect integration.

### Shared types

- [src/types.ts](src/types.ts): app state, plate and feature models, and tool or projection types.

### Export systems

- [src/export.ts](src/export.ts): PNG and JSON export flows.
- [src/GeoPackageExporter.ts](src/GeoPackageExporter.ts): GeoPackage export path.
- [src/systems/HeightmapGenerator.ts](src/systems/HeightmapGenerator.ts): raster heightmap generation.

## Notes on historical documents

These files remain useful as delivery records, but parts of them describe earlier implementation states and should be read as historical snapshots rather than current architecture:

- [README_COMPLETION.md](README_COMPLETION.md)
- [DELIVERY_REPORT.md](DELIVERY_REPORT.md)
- [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)
- [FEATURE_QUICK_REFERENCE.md](FEATURE_QUICK_REFERENCE.md)
- [FEATURE_IMPLEMENTATION_COMPLETE.md](FEATURE_IMPLEMENTATION_COMPLETE.md)

Some of those historical docs refer to runtime systems or files that are not present in the current `src/` tree, including `ElevationSystem.ts` and `TimeTransformationUtils.ts`.

## Current repo reality checks

- The app currently builds successfully with `npm run build`.
- The active codebase is Electron, Vite, and TypeScript with a vanilla DOM UI.
- Time controls exist, but the active code path uses direct internal time values rather than a separate live time transformation module.
- Heightmap and GeoPackage export paths exist.
- A mesh-based elevation editor is not currently wired into runtime.
- Some legacy or deprecated systems remain in the codebase for compatibility or future cleanup.

## Recommended usage

- Use [DEVELOPER_README.md](DEVELOPER_README.md) plus the `src/` tree when making code changes.
- Use older completion and delivery reports only for project history.
- Revisit this index whenever architecture or delivery status changes.
