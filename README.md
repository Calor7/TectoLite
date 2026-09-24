# TectoLite

TectoLite is a visual tectonic-plate simulation editor for designing plates, assigning Euler-pole motion, editing geological features, and exploring a world's plate history. It runs as a Vite web application and as an Electron desktop application.

## Current status

TectoLite 1.1 provides the core editing, simulation, undo/redo, project save/load, project templates, image overlays, and export workflows. Saved projects are migrated forward when the file format changes.

Oceanic crust generation is experimental. It is disabled by default and appears under **Settings → Experimental**. The feature can create large or unexpected geometry, so save the project before enabling it.

The retired guided-event automation prototype, mesh runtime, and unused elevation-editing runtime are not part of the active application. `HeightmapGenerator` remains active for raster export.

## Download

[Download the latest portable Windows app](https://github.com/Calor7/TectoLite/releases/latest/download/TectoLite-Portable-1.1.0-x64.exe), or browse [all TectoLite releases](https://github.com/Calor7/TectoLite/releases).

## Playable geological timelines

Choose **File → New project → Explore example worlds → Playable timelines**. Both Pangaea and modern Earth offer **Covers** and **Covers + Plates** variants, alongside the original static starts.

- **Pangaea → present:** 200 million years of curated reconstruction with representative GPlates finite rotations, continental breakup, India–Eurasia collision, animated shapes, and illustrative emergence.
- **Earth → +500 Myr:** a model-inspired Pacific-closure Amasia scenario, with an authored later breakup. The exact map, paths, and event dates are illustrative; there is no consensus forecast at this timescale.

Use the chapter menu to jump, or play and scrub continuously. The guide shows geological age; editor fields use elapsed millions of years. Each split, fusion, motion segment and shape stage is editable in entity History. The detailed variants add linked motion carriers and representative cratons. Optional **Animate toward the next shape** interpolates stages with matching vertices.

Save **Entire timeline** to retain the whole example, or **From current time** to keep its remaining history. **Guide & sources → Use current world as a new starting point** creates a fresh project without the later scripted events. Everything runs offline in the desktop app. Source notes and scientific limits are in [the scenario plan](docs/PLAN_geological_scenarios.md).

## Development

Requirements: Node.js 20 or newer and npm.

```bash
npm ci
npm run dev
```

Useful commands:

```bash
npm run verify                 # lint, type-check, Electron syntax, tests, production build
npm run electron-dev           # Vite + Electron development session
npm run electron-build         # package the current platform
npm run smoke:electron-export  # production Electron GeoPackage export smoke test
```

## Core workflows

- Draw, edit, split, link, and fuse tectonic plates.
- Configure plate motion with Euler poles and motion segments.
- Place and edit geological features.
- Scrub and play plate history.
- Save and load TectoLite JSON projects with format migration.
- Start from blank, modern Earth, or Pangaea templates.
- Export PNG maps, heightmaps, JSON projects, and GeoPackage data.
- Preview PNG exports with independent grid, plate-outline, geological-line, feature, and label controls. Grids can render above land.
- Choose a transparent background or the **Edit in another app** preset for borderless artwork; **Match current view proportions** avoids aspect-ratio cropping.
- PNGs are flat images. Use **Editable project → Entire Timeline** to keep the complete map and its history editable in TectoLite; use GeoPackage for GIS vector editing.

## Project layout

- `src/main.ts` — application orchestration and UI control wiring.
- `src/types.ts` — shared state and domain types.
- `src/SimulationEngine.ts` — time-dependent plate derivation and ocean-generation strategies.
- `src/canvas/` — rendering and interaction tools.
- `src/ui/` — application template and focused UI modules.
- `src/systems/TimelineSystem.ts` — plate-history controls.
- `src/migration.ts` — versioned save-file migrations.
- `electron-main.cjs` / `preload.cjs` — secure Electron host integration.

See [DEVELOPER_README.md](DEVELOPER_README.md) for architecture and contribution details.

## Release process

Pull requests and pushes run the verification workflow on Windows, macOS, and Linux. Version tags (`v*`) additionally package the Electron application and publish the generated artifacts through GitHub Releases.

Before tagging a release:

1. Run `npm run verify`.
2. Run `npm run smoke:electron-export` on the target desktop platform.
3. Open the packaged application and manually exercise draw/edit/split, save/load, undo/redo, templates, and export.
4. Confirm that experimental features remain disabled in a new project.

## License

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE.txt](NOTICE.txt) for attribution.

## Asset attribution

<a href="https://www.flaticon.com/free-animated-icons/coffee-mug" title="coffee mug animated icons">Coffee mug animated icons created by Magnific - Flaticon</a>
