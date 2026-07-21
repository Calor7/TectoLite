# BRIEF_13 - Mobile feasibility spike: prove the runtime on real devices

Release: v1.1.0 Mobile - Size: S - **Physical Android and iOS devices required**

## Goal and why

TectoLite's simulation and renderer are already browser-native TypeScript,
Canvas 2D, WebAssembly, and Vite, so Capacitor should be a thin native host.
"Should" is not enough for a release plan: the largest bundled Earth template,
high-DPI canvas rendering, `sql.js` GeoPackage generation, Blob downloads, and
process suspend/resume have not run inside Android WebView or iOS WKWebView.

This brief creates the smallest useful Capacitor 8 shell, runs the unmodified
desktop-layout app on physical devices, records measurements and failures, and
ends with a written go/no-go decision. It does not attempt to make the current
desktop UI usable on a phone.

## The map

- Web build: `vite.config.ts` writes the self-contained app to `dist/` with
  relative asset paths, already suitable for Capacitor `webDir: "dist"`.
- Runtime dependencies: `package.json`; Capacitor 8 requires Node 22+, while
  the current README only promises Node 20.
- Canvas/DPR allocation: `src/canvas/CanvasManager.ts` `resizeCanvas()` and
  `render()`.
- Heavy data: bundled Modern Earth and Pangaea templates in `src/assets/`.
- WASM/export path: `public/vendor/sql.js/`, `src/GeoPackageExporter.ts`,
  `src/export.ts`, and `src/systems/HeightmapGenerator.ts`.
- Existing benchmark surface: `?perf=bench1` and `src/utils/PerfMonitor.ts`.

## Fixed technical decisions

- Native runtime: **Capacitor 8**, without Ionic Framework or another UI
  framework.
- Shared output: `webDir: "dist"`; no separate mobile web build or `src/` fork.
- Proposed app id: `com.refracturedgames.tectolite`. Confirm ownership before
  signed/store builds; an app id cannot be changed after publication.
- Android: compile/target API 36; provisional minimum API 29 (Android 10).
- iOS: provisional minimum iOS 15; Xcode 26 and Swift Package Manager.
- `android/` and `ios/` are source when the spike is accepted, not disposable
  build output.
- No analytics, accounts, networking, or new runtime permissions.

## Work items

1. **Prepare the toolchain without changing product behavior.**
   - Raise the documented requirement to Node 22+ and add matching
     `engines.node` metadata.
   - Add matching-major `@capacitor/core`, `@capacitor/cli`,
     `@capacitor/android`, and `@capacitor/ios` packages.
   - Add `capacitor.config.ts` using the fixed decisions above.
   - Add `mobile:sync`, `mobile:android`, and `mobile:ios` scripts; sync scripts
     build first so stale `dist/` cannot be packaged.
2. **Create native projects.** Generate `android/` with Android Studio and
   `ios/` with Xcode/SPM. Add no product plugins. A one-off diagnostic probe is
   allowed only if isolated, documented, and removed before completion.
3. **Run on physical hardware.** Minimum matrix:
   - an API 29-class Android device with approximately 4 GB RAM;
   - a current Android/API 36 device (plus emulator only as supplementary);
   - a small-screen iPhone and a current iPhone or iPad.
   A simulator never replaces the physical iPhone result.
4. **Exercise the same scenario on every device.**
   - cold launch offline and load the largest selectable Earth template;
   - rotate, translate, zoom, select, scrub, and play for 30 seconds;
   - background for 30 seconds, resume, then force-close and reopen;
   - import `Antarctica_Example.json` through the existing file input;
   - generate JSON, 2048x1024 PNG, 2048x1024 heightmap, and GeoPackage output;
   - record generation, discoverability/opening, and sharing separately.
     Anchor-download UX failure belongs to BRIEF_14; generation crashes or
     corrupt output fail this spike.
5. **Measure representative performance.** Record cold-launch time,
   template-load time, playback average and p95 frame time, export duration, and
   observed memory pressure. Do not cap DPR or tune code before measuring.
6. Create `docs/MOBILE_SPIKE_REPORT.md` with toolchain versions, exact devices
   and OS versions, scenario results, measurements, evidence for failures, and
   one verdict:
   - **GO** - proceed to BRIEF_14 unchanged;
   - **GO WITH LIMITS** - list explicit export/resolution/device floors;
   - **STOP** - name the blocker and smallest next experiment.

## Pass/fail gates

- The largest bundled template loads without renderer crash or WebView reload
  on each supported-floor physical device.
- Playback sustains at least 30 fps average in the representative scene. A p95
  miss is recorded; average below 30 fps is GO WITH LIMITS or STOP.
- JSON/PNG/heightmap generation produces valid non-empty output.
- GeoPackage generation completes without termination on the current iPhone and
  Android device. Low-memory-only failure should yield a measured mobile limit.
- Offline cold launch and bundled templates work with radios disabled.

## Invariants and traps

- Desktop-shaped layout, missing touch gestures, and download UX are expected
  findings, not reasons to expand this spike into BRIEF_14/15.
- Do not lower resolution, remove templates, or disable exports to make it green.
- Do not introduce a second entry point or fork simulation state for mobile.
- Review generated projects for signing noise and machine-local paths. Never
  track credentials, provisioning data, keystores, or SDK paths.
- Capacitor and official plugin major versions must match.

## Acceptance criteria

- [ ] Capacitor 8 Android and iOS projects package the existing `dist/` build.
- [ ] The app launches offline on physical Android and iPhone hardware.
- [ ] `docs/MOBILE_SPIKE_REPORT.md` contains the full device/result matrix,
      measurements, failures, and GO / GO WITH LIMITS / STOP verdict.
- [ ] Canvas, templates, WASM, and every export generator have explicit results.
- [ ] No credentials or local machine paths are tracked.
- [ ] `npm run verify` remains green and the Electron production build launches.

## Non-goals

No responsive redesign, touch gestures, native project library, durable mobile
autosave, store upload, signing automation, analytics, framework rewrite, or
simulation changes.

## Authority boundaries

- Confirm the final app id with the user before any signed build.
- Apple/Play signing, provisioning, or external upload requires explicit user
  authorization and access to user-owned accounts.
- Without a Mac and physical iPhone the brief remains incomplete; do not claim
  GO from Android-only evidence.

## Report format

Verdict first; device matrix; performance/export exceptions; files changed;
commands run; exact follow-up limits. Append unrelated findings to
`docs/restructure-tasks/out-of-scope-list`.
