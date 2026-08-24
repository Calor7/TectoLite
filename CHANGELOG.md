# Changelog

All notable changes to TectoLite are documented here.

## Unreleased

## 1.0.8 - 2026-08-24

### Fixed

- Kept the canvas painted while Explorer, Tool Options, and Properties animate
  open or closed by skipping no-op backing-store resets and redrawing real
  canvas resizes before the browser presents the frame.

## 1.0.7 - 2026-08-24

### Fixed

- Updated the release verification fixture for the new default-on motion-speed
  coloring so Windows downloads can be published by CI.

## 1.0.6 - 2026-08-24

### Changed

- Motion-label fill now shifts from its normal color at 6 cm/yr to the warning
  color at 8 cm/yr. The warning outline begins above 15 cm/yr and reaches full
  strength at 20 cm/yr; all four thresholds remain customizable. Speed coloring
  is enabled by default.
- Moved UI and canvas appearance controls from Settings to View. View now groups
  appearance, workspace panels, projection, reference images, camera views, and
  map display, while Settings contains simulation, planet, drawing-default, and
  experimental behavior.

## 1.0.5 - 2026-08-24

### Changed

- Speed-limit highlighting now starts at the 6 cm/yr base speed, reaches its
  light-red maximum at 15 cm/yr, and gains its outer outline from 15 to 20
  cm/yr. The three thresholds remain customizable in Appearance settings.

## 1.0.4 - 2026-08-24

### Added

- Added saved Appearance controls for canvas motion-label colors and optional
  speed-limit highlighting, including configurable warning start, realistic
  maximum, and full-outline thresholds.

### Changed

- Canvas motion labels are white by default. With speed highlighting enabled,
  labels transition to light red from 18 to 20 cm/yr, then gain a red outer
  outline that fades in from 20 to 25 cm/yr.
- Grouped the Ko-fi and Windows actions at the right edge of the header and
  renamed the rightmost action to **Download app**.

### Fixed

- Fixed canvas speed text losing contrast when it overlaps a landmass.

## 1.0.3 - 2026-08-24

### Added

- Added saved Appearance settings for UI background, panel, control, text, and
  accent colors, with a default-colors checkbox that restores theme precedence.

### Changed

- Motion units such as `cm/yr` and `deg/Ma` now use a dedicated high-contrast
  color: white in the default dark theme and near-black in the light theme.
- Light/Dark theme selection is now restored when the app starts.

## 1.0.2 - 2026-08-24

### Added

- Added a hover-activated, reduced-motion-aware Ko-fi mug animation with the
  creator attribution recorded in the README.
- Added a prominent web-only Windows download button targeting the portable
  executable from the latest GitHub Release.
- Added first-class flag labels with always-visible titles, click/hover detail
  expansion, globe occlusion, plate-relative or fixed anchoring, draggable
  anchors and text cards, grouping, locking, visibility, color, persistence,
  undo/redo, and merge-import support.
- Added durable crash recovery using an atomic desktop file or browser IndexedDB,
  with visible save status and a restore prompt after an interrupted session.
- Added a first-run project chooser, File and Help menus, keyboard-shortcut guide,
  accessible shared dialogs, and contextual workflow guidance.
- Added deep project-file validation and migration limits, a strict renderer CSP,
  lifecycle integration tests, and release coverage/security gates.
- Added signed-release configuration, cross-platform packaging, packaged export
  smoke tests, and SHA-256 artifact manifests.

### Changed

- Increased timeline surface and event-icon contrast in both themes.
- Tool names are now shown by default and can be hidden independently of the
  Tool Options dock.
- Tool Options and Properties are persistent, explicitly controlled docks;
  Properties now shows a calm empty state when nothing is selected.
- Kept Ko-fi as a dedicated top-right button in both the web and desktop apps,
  without duplicating it inside Help.
- Refined the interface with the Basalt Field palette, restrained monochrome
  icons, clearer controls, and responsive Refractured Games and Ko-fi links.
- Lines now render above landmasses at equal layer priority, while explicit
  layer values still control intentional overrides.
- Upgraded Electron and the release toolchain and hardened desktop navigation,
  permissions, IPC sender checks, application fuses, and autosave storage.

### Fixed

- Fixed tool changes collapsing or reopening sidebars and interrupting the
  workspace layout; panel visibility controls now keep their accessible state
  synchronized as well.
- Fixed right-sidebar tutorial cards covering the central manual and hardened
  tutorial content wrapping near its right edge.
- Fixed image export aspect-ratio handling so output crops the visible surface
  instead of revealing a wider or taller map area.
- Fixed custom colors not applying consistently to selected line features.
- Fixed overlays such as orogenies drifting after their linked parent plates
  fuse, including later changes to the fused plate's motion.
- Fixed current-time exports retaining links to retired pre-fusion plates.

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
