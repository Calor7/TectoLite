# Changelog

All notable changes to TectoLite are documented here.

## 1.0.1 - 2026-07-17

### Added

- Added Shift-click range selection across visible Explorer entities, including bulk group assignment, dragging, and deletion.
- Added persistent per-group transparency controls with live canvas updates and undo support.

### Fixed

- Fixed Settings and View dropdowns being clipped inside the horizontally scrollable header.

## 1.0.0 - 2026-07-16

### Changed

- Moved oceanic crust generation into a clearly marked Experimental settings section.
- Replaced overlapping ocean-generation toggles with one mutually exclusive strategy.
- Centralized persistent project-setting bindings and expanded unsaved-change tracking.
- Improved responsive header behavior, dropdown scrolling, keyboard dismissal, and tooltip accessibility.
- Renamed Event Timeline to Plate History and moved derived-boundary visualization into View.
- Split the large modern-Earth cover dataset into lazy-loaded chunks.
- Strengthened Electron IPC validation, explicit renderer sandboxing, and user-data bug-report storage.
- Expanded the standard verification and CI gate to include lint and Electron host-script syntax checks.
- Updated Electron, Vite, and the packaging toolchain to audited dependency versions with no known vulnerabilities.

### Added

- Added focused regression tests for split, fusion, boundary detection, settings markup, migration, and template loading.
- Added a reproducible TectoLite application icon and Windows portable-package configuration.
- Added a production Electron GeoPackage export smoke command.
- Added the Apache License 2.0 and packaged license notices.

### Fixed

- Fixed packaged startup by replacing the unpackaged `electron-is-dev` runtime dependency with Electron's built-in `app.isPackaged` state.
- Prevented duplicate IPC handler registration when recreating the application window.

### Removed

- Removed the retired guided-event automation prototype and its unused UI controls.

### Compatibility

- Added save-format migrations that remove retired event data and map legacy ocean-generation flags to the new strategy setting.
