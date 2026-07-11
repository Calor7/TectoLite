# TectoLite Patch Notes — v0.1.3

*July 11, 2026*

---

## ✨ What's New

### 🐛 Report Bug Button
A new **Report Bug** button (🐛) now sits in the header toolbar. Click it
to open a bug-report form with:
- **Description** (required) and **Steps to reproduce** fields
- **Severity** selector (Minor / Major / Critical)
- **Your email** (optional, remembered for next time)
- **Include screenshot** checkbox — captures the current canvas and
  copies it to your clipboard (or downloads it if clipboard isn't
  available), so you can paste it straight into your email

The report opens your default mail client pre-addressed to
`mail@refracturedgames.com` with subject `bug-tectolite`, including your
description, steps, severity, and app version/platform info automatically.

### 🌍 Project Templates
You no longer have to start from a blank sphere! The **New Project**
dialog now offers preset starting worlds:

- **Modern Earth** — recognizable coastlines grouped into 7 continental
  regions with predefined plate motions
- **Pangaea (~200 Ma)** — Early Jurassic supercontinent arrangement
- **Blank World** — the classic empty sphere, for when you want to build
  from scratch

### 🆕 New Project / Clear World
A dedicated **New** button in the header toolbar lets you start a fresh
project at any time. A confirmation dialog prevents accidental data loss.
Creating a new project resets the simulation, history, and autosave.

### 📊 Performance Overlay
A new performance monitor tracks frame times and phase durations (sim,
derive, render) with a live overlay. Accessible via `?perf=bench1` URL
parameter for benchmarking with a deterministic test world.

---

## ⚡ Performance Improvements

- **Idle rendering eliminated**: The canvas now only re-renders when
  something actually changes. Idle CPU usage drops to near-zero instead
  of continuously redrawing every frame.
- **Projection caching**: Pan and zoom are smoother — the projection is
  only recalculated when the viewport or projection type actually changes.
- **Plate derivation memoization**: Scrubbing the timeline back and forth
  is faster — plate positions at previously-computed times are cached
  instead of re-derived.
- **Smarter history snapshots**: Undo/redo uses structural sharing
  instead of deep-cloning the entire world on every action, reducing
  memory usage for long editing sessions.

---

## 🔧 Background Changes

- **Save file migration**: Added a versioned migration layer (save v4).
  Older save files are automatically migrated on load. Future save
  versions will upgrade gracefully.
- **Motion model cleanup**: Completed the migration to the keyframe-less
  motion model. Legacy rotation fields have been removed; old saves are
  converted automatically.
- **Line rendering improvements**: Refined boundary line rendering and
  edge metadata handling.
- **Event system reset**: Interaction event detection is now properly
  reset when restoring autosaves, importing, undoing, and redoing — no
  more stale events from previous project states.
- **Codebase cleanup**: Removed the unused CausalGraph and
  GeologicalAutomation systems. Extracted shared geometry utilities
  (`isPointInPolygon`) into a reusable module. Moved `@types/*` packages
  to devDependencies.
- **Type safety**: Canvas and timeline systems are now decoupled from
  `app: any` — they use typed interfaces for callbacks and dependencies.
- **Build pipeline**: App version is now injected at build time from
  `package.json` via Vite, ensuring the bug report always includes the
  correct version.

---

## 🧪 Testing

- Test suite expanded to **81 tests** across 7 files
- New tests for migration, EventSystem reset, project templates, and
  spherical math utilities

---

*Full technical details in the [review report](docs/restructure-tasks/REVIEW_REPORT_2026-07-11.md)
and [roadmap](docs/ROADMAP.md).*