# BRIEF_14 - Mobile platform services: files, autosave, lifecycle, and sharing

Release: v1.1.0 Mobile - Size: M - Requires BRIEF_13 GO or GO WITH LIMITS

## Goal and why

The renderer currently owns browser downloads, `main.ts` stores a whole active
world in `localStorage`, and Electron behavior is reached through a small preload
bridge. These mechanisms are not a safe mobile document model: anchor downloads
have no predictable destination, localStorage is not durable project storage,
and a mobile process can be suspended or killed without a close event.

This brief introduces a typed platform boundary with Web, Electron, and
Capacitor implementations. Import/export, autosave, external links, bug reports,
and lifecycle events use that boundary without host checks spread across UI and
domain code.

## The map

- Browser download/file parsing: `src/export.ts`.
- GeoPackage generation/download coupling: `src/GeoPackageExporter.ts`.
- Autosave/restore: `src/main.ts` `AUTOSAVE_KEY`, `autosaveNow()`,
  `setupAutosave()`, and `offerAutosaveRestore()`.
- Electron bridge: `preload.cjs`, `electron-main.cjs`, `src/globals.d.ts`.
- External links and bug reports: `src/main.ts` plus Electron IPC.
- Save migrations: `src/migration.ts`; all hosts use this one pipeline.

## Platform contract

Add `src/platform/` with a facade composed from focused services:

```ts
type PlatformKind = 'web' | 'electron' | 'capacitor';

interface PlatformServices {
  kind: PlatformKind;
  files: ProjectFileService;
  autosave: AutosaveStore;
  lifecycle: LifecycleService;
  external: ExternalLinkService;
}
```

Required behavior:

- `openProject()` returns file name plus text/bytes, or null on cancellation; it
  does not parse/migrate domain data.
- `saveProject()` and `exportFile()` accept suggested filename, MIME type, and
  Blob/bytes, and return `saved`, `shared`, `cancelled`, or `failed`.
- `AutosaveStore` reads, atomically writes, and clears one recovery document.
- `LifecycleService` reports foreground/background and Android Back events.
- External links accept only existing `http`, `https`, and `mailto` schemes.

Use injected fakes in tests. App/domain modules import the facade or focused
interfaces, never `@capacitor/*` directly.

## Work items

1. **Separate generation from delivery.** Refactor JSON, PNG, heightmap,
   bug-report, and GeoPackage paths so generation returns Blob/bytes plus
   metadata. Route delivery through `ProjectFileService`. Preserve filenames and
   current Web/Electron behavior unless an existing failure is documented.
2. **Implement Web services.** Retain hidden file input/FileReader for import and
   anchor downloads for output as the browser fallback.
3. **Implement Electron services.** Preserve context isolation and the allowlist.
   Prefer renderer generation plus narrow IPC save-dialog/write operations;
   never expose arbitrary filesystem or Node APIs. Keep unsaved-close behavior.
4. **Implement Capacitor services.**
   - Use the system document/file UI exposed to the WebView for JSON import; do
     not request broad storage access.
   - Write generated files to an app-owned temporary export directory and open
     the native share sheet for Files, Drive, Mail, and user-selected targets.
   - Clean temporary exports on next launch or after a conservative retention
     window.
   - Enforce limits from `docs/MOBILE_SPIKE_REPORT.md`.
5. **Replace mobile autosave storage.**
   - Atomically write `active-autosave.json` in app data storage using temp file
     plus rename/replace, so interruption cannot destroy the previous save.
   - Preferences/localStorage may store only small metadata; never mobile world
     JSON.
   - Web/Electron retain compatible behavior unless safe migration is trivial.
6. **Wire lifecycle behavior.** Autosave every two minutes while dirty,
   immediately on background, and after completed edit transactions. Restore
   still requires confirmation. Android Back closes a modal/sheet first and
   never silently discards a dirty project.
7. **Add contract tests** for cancellation, write failure, interrupted atomic
   save, migration after open, URL rejection, lifecycle debounce, and export
   result messaging. Existing migration tests remain authoritative.
8. Update `DEVELOPER_README.md` with the boundary, native file flow, and rule
   that only `src/platform/capacitor*` imports Capacitor packages.

## Invariants and traps

- One save format and migration pipeline serves every host. No mobile save fork.
- Blob generation is not a successful save. Clear dirty state only after an
  appropriate durable outcome; sharing an image export is not saving a project.
- Share cancellation is normal, not an error.
- Base64 conversion can multiply peak memory. Avoid copies and honor spike
  limits, especially for GeoPackage and large PNG exports.
- Cache is valid for temporary exports, never the sole autosave.
- Request no broad Android storage permission and do not expose private paths as
  user-accessible documents.
- Keep Electron sandboxing, context isolation, and URL allowlists unchanged.

## Decision log

- Platform adapters, not scattered `Capacitor.isNativePlatform()` checks.
- Native share sheet is the v1 export destination; an in-app project library is
  deferred until usage evidence supports it.
- App-data file for autosave; Preferences/localStorage for metadata only.
- Existing `<input type="file">` is the first mobile import mechanism. A custom
  picker plugin is evidence-gated.

## Acceptance criteria

- [ ] Web, Electron, and Capacitor use shared domain import/export code through
      typed services.
- [ ] No non-platform module imports `@capacitor/*` or accesses Electron globals.
- [ ] Android/iOS import JSON from system Files/document UI; JSON, PNG, and
      heightmap can be shared and reopened.
- [ ] GeoPackage follows BRIEF_13's verdict and is valid wherever enabled.
- [ ] Dirty mobile state survives backgrounding and forced termination; an
      interrupted write leaves the previous autosave recoverable.
- [ ] Cancellation is quiet; failures are actionable and never clear dirty state.
- [ ] External URL allowlists and Electron security settings remain intact.
- [ ] New tests, `npm run verify`, desktop save/load/export, and the Electron
      export smoke test pass.

## Non-goals

No responsive UI, touch gestures, cloud sync, multi-project library, background
upload, open-in registration, analytics, or store release.

## Authority boundaries

- Native plugins beyond official Capacitor file/share/app/browser capabilities
  require user approval plus maintenance/license review.
- Do not request storage, contacts, photos, location, camera, or network
  permissions merely to simplify implementation.
- Signing and external distribution remain out of scope.

## Report format

Operation x platform behavior matrix; autosave kill-test results; export sizes
and durations; security changes; files changed; verification commands. Append
unrelated findings to `docs/restructure-tasks/out-of-scope-list`.
