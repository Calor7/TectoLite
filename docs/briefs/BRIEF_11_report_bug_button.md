# BRIEF_11 — Report Bug Button

Release: hotfix (post-v0.2) · Size: S–M

## Goal and why

Users have no in-app channel to report bugs. Today they must notice the
small GitHub/Ko-fi links in the header, infer the repo URL, and navigate
there manually — almost nobody does. A visible "Report Bug" button in the
header gives every user a one-click path to a structured bug-report form
that emails `mail@refracturedgames.com` with subject `bug-tectolite`.

The button sits at the **end of the header-actions bar** (right of the
last existing button, `btn-import-json`). The user said "right of legend
button" but **no legend button exists yet** (it's planned in BRIEF_03 /
BRIEF_06, not implemented). Placing the bug button at the end of
header-actions achieves the user's intent — it's the rightmost button in
the header — and doesn't depend on unimplemented work.

## The map

- **Header buttons**: `src/ui/AppTemplate.ts` lines 36–312 —
  `<div class="header-actions">` contains all toolbar buttons. The last
  button is `btn-import-json` (line 304). The closing `</div>` is at line
  311 (after two hidden `<input type="file">` elements). **Insert the new
  button between `btn-import-json` and the hidden inputs** (after line 307).
- **Button pattern to imitate** (nearest sibling — `btn-import-json`):
  ```html
  <button id="btn-import-json" class="btn btn-secondary" title="Import JSON">
      <span class="icon">📂</span> Load
  </button>
  ```
  Follow the same `id="btn-..."` / `class="btn btn-secondary"` / `title=""`
  / `<span class="icon">emoji</span> Label` pattern.
- **Event listener wiring**: `src/main.ts` `setupEventListeners()` —
  all header button listeners are registered here. The last one is
  `btn-tutorial-help` at line 1642. **Add the new listener after it**
  (before the method's closing brace at line 1647).
- **Modal dialog**: `src/ui/ModalSystem.ts` `showModal(options)` —
  the existing generic modal builder. Takes `ModalOptions` (`title`,
  `content` as HTML string, `width?`, `buttons: ModalButton[]`). Each
  `ModalButton` has `text`, `subtext?`, `isSecondary?`, `onClick()`.
  The modal creates an overlay + dialog, appends to `document.body`,
  and removes itself on button click. **Use this for the bug-report form.**
- **Email sending**: No email library exists and no IPC channel for email.
  Use a `mailto:` URL — `window.open(mailtoUrl)` opens the user's default
  mail client. This works in both Electron and web builds. Construct the
  URL with `encodeURIComponent` for body content.
- **CSS**: `src/style.css` — `.btn` (line 547), `.btn-secondary` (line 569),
  `.header-actions` (line 178). No new CSS classes needed; the bug button
  uses the same classes as every other header button. The modal form
  fields use inline styles consistent with `showModal`'s existing pattern.
- **Canvas screenshot**: `src/canvas/CanvasManager.ts` — the canvas is a
  private field (`private canvas: HTMLCanvasElement`, line 31). There is
  no public getter. Add a `captureScreenshot(): string` method that returns
  `this.canvas.toDataURL('image/png')`. The canvas is a single 2D context
  (`#main-canvas` in `AppTemplate.ts` line 508). `toDataURL` captures the
  full backing store (DPR-scaled) — this is fine for a screenshot.
- **Version injection**: `vite.config.ts` has no `define` block. Add
  `define: { __APP_VERSION__: JSON.stringify(pkg.version) }` reading the
  version from `package.json` at build time. Declare
  `declare const __APP_VERSION__: string;` in `src/types.ts`. This
  auto-updates the version on every build — no manual constant to maintain.
- **Clipboard API**: `navigator.clipboard.write()` with `ClipboardItem` is
  available in Chromium (Electron's engine). No IPC needed. Fallback to
  download if clipboard write fails (permissions, old Electron).

## Work items

1. **Add `__APP_VERSION__` to `vite.config.ts`** — read `package.json`
   and inject the version at build time:
   ```typescript
   import pkg from './package.json' with { type: 'json' };
   // ... in defineConfig:
   define: { __APP_VERSION__: JSON.stringify(pkg.version) }
   ```
   Add `declare const __APP_VERSION__: string;` to `src/types.ts`.

2. **Add `captureScreenshot()` to `CanvasManager`** in
   `src/canvas/CanvasManager.ts`:
   ```typescript
   public captureScreenshot(): string {
       return this.canvas.toDataURL('image/png');
   }
   ```

3. **Add the button** in `src/ui/AppTemplate.ts` — insert after
   `btn-import-json` (line 307), before the hidden `<input>` elements:
   ```html
   <button id="btn-report-bug" class="btn btn-secondary" title="Report a Bug">
       <span class="icon">🐛</span> Report Bug
   </button>
   ```

4. **Add the event listener** in `src/main.ts` `setupEventListeners()`,
   after the `btn-tutorial-help` listener (line 1644):
   ```typescript
   document.getElementById('btn-report-bug')?.addEventListener('click', () => {
       this.showBugReportDialog();
   });
   ```

5. **Add `showBugReportDialog()` method** to the `TectoLiteApp` class in
   `src/main.ts`. This method:
   - Builds a form with fields: **Description** (textarea, required),
     **Steps to reproduce** (textarea, optional), **Severity**
     (select: Minor / Major / Critical, default Minor), **Email**
     (text input, optional — prefilled from localStorage if previously
     saved), **Include screenshot** (checkbox, checked by default).
   - Uses `showModal()` from `ModalSystem.ts` to display the form.
   - The modal has two buttons:
     - **"Send Report"** (primary) — validates that Description is
       non-empty, then:
       1. If "Include screenshot" is checked, capture the canvas via
          `this.canvasManager.captureScreenshot()`, convert the data URL
          to a `Blob`, and try
          `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`.
          If clipboard write succeeds, show a message: "Screenshot copied
          to clipboard — paste (Ctrl+V) into your email." If it fails,
          fall back to downloading the PNG (create an `<a>` element with
          `download` attribute, same pattern as `exportToPNG` in
          `src/export.ts` line 133–137) and show: "Screenshot saved to
          Downloads — attach it to your email."
       2. Construct a `mailto:` URL:
          ```
          mailto:mail@refracturedgames.com
            ?subject=bug-tectolite
            &body=<encoded body>
          ```
          The body is assembled from the form fields:
          ```
          Description: <user text>

          Steps to reproduce:
          <user text or "(not provided)">

          Severity: <selected value>

          --- App info ---
          TectoLite version: <__APP_VERSION__>
          Platform: <navigator.platform>
          User agent: <navigator.userAgent>
          ```
       3. Call `window.open(mailtoUrl)`. If it returns `null`, try
          `window.location.href = mailtoUrl` as secondary fallback. If
          both fail, show the fallback message: "Could not open your
          email client. Please manually email
          mail@refracturedgames.com with subject 'bug-tectolite'."
     - **"Cancel"** (secondary) — closes the modal, does nothing.
   - Saves the user's email to localStorage (`tectolite-bug-email`) if
     provided, so it's pre-filled next time.

6. **Form rendering inside `showModal`**: The `content` field of
   `ModalOptions` is an HTML string. Build the form inputs as HTML, then
   after the modal is shown, query the elements by ID to read values on
   "Send Report" click. Since `showModal` doesn't return a reference to
   the dialog DOM, use unique IDs (`bug-description`, `bug-steps`,
   `bug-severity`, `bug-email`, `bug-screenshot`) and
   `document.getElementById()` to read them from inside the `onClick`
   handler. This is the same pattern the existing `showModal` callers use
   (e.g. the time-input modal reads values by ID after showing).

## Invariants and traps

- **`mailto:` body length**: Some email clients truncate long `mailto:`
  bodies (Outlook ~2000 chars, Gmail web ~2000 chars). Keep the body
  concise — the app-info block is small (version + platform + UA). If
  the user writes a very long description, it still works but may be
  truncated by the client; this is acceptable for a bug-report button.
- **`window.open` in Electron**: Electron's `window.open` with a
  `mailto:` URL delegates to the OS default mail handler. This works
  on Windows/macOS/Linux. If no mail client is configured, `window.open`
  may return `null` or open a blank window — handle both: check the
  return value and show the fallback message if falsy.
- **No server-side submission**: This is a `mailto:` approach only —
  no HTTP endpoint, no backend. The email is composed in the user's mail
  client; the user must click "Send" in their mail app. This is by
  design (no backend infrastructure for TectoLite). If a future
  server-side endpoint is added, the `showBugReportDialog` method is
  the single place to change the submission mechanism.
- **Version string**: Injected at build time via Vite `define` —
  `__APP_VERSION__` is a compile-time constant read from `package.json`.
  No runtime file access needed. Declared in `src/types.ts` as a global
  `declare const`.
- **Screenshot clipboard permissions**: `navigator.clipboard.write()`
  requires a secure context (HTTPS or localhost). Electron's
  `file://` protocol is treated as a secure context, so this works in
  production Electron builds. In dev mode (`http://localhost:5173`), it
  also works. If `navigator.clipboard` is undefined or `write()` rejects,
  fall back to downloading the PNG file.
- **`ClipboardItem` availability**: `ClipboardItem` is available in
  Chromium 76+ (Electron uses a recent Chromium). If undefined, fall back
  to download.
- **Screenshot timing**: The screenshot is captured at the moment the
  user clicks "Send Report", showing the current canvas state. This is
  the correct behavior — the user sees what they're reporting.
- **Modal stacking**: `showModal` creates a new overlay each time. If
  the user clicks "Report Bug" while another modal is open, two
  overlays stack. This is acceptable (the existing modals have the same
  behavior). The bug-report modal's z-index (10000 from `showModal`)
  will be above any prior modal — fine.
- **XSS in form values**: The form values go into a `mailto:` URL via
  `encodeURIComponent`, not into `innerHTML`. Never inject user-typed
  text into `innerHTML` — only into the encoded URL. The `showModal`
  `content` is static HTML (the form skeleton); dynamic values are read
  from input elements, not interpolated into HTML.

## Acceptance criteria

1. `npx tsc --noEmit` passes.
2. `npx vitest run` passes (no new tests required — this is UI-only).
3. `npx vite build` passes.
4. `grep -c "btn-report-bug" src/ui/AppTemplate.ts` → 1 (button exists).
5. `grep -c "btn-report-bug" src/main.ts` → ≥1 (listener registered).
6. `grep -c "showBugReportDialog" src/main.ts` → ≥2 (method definition +
   call site).
7. `grep -c "mail@refracturedgames.com" src/main.ts` → ≥1 (email
   address present).
8. `grep -c "bug-tectolite" src/main.ts` → ≥1 (subject line present).
9. `grep -c "captureScreenshot" src/canvas/CanvasManager.ts` → ≥1
   (screenshot method exists).
10. `grep -c "__APP_VERSION__" vite.config.ts` → ≥1 (version injection
    configured).
11. `grep -c "__APP_VERSION__" src/types.ts` → ≥1 (global declaration).
12. Manual test: click "Report Bug" button → modal appears with form
    fields (Description, Steps, Severity, Email, Include screenshot
    checkbox).
13. Manual test: fill in description, check screenshot, click "Send
    Report" → screenshot is copied to clipboard (or downloaded as PNG),
    and default mail client opens with `To:
    mail@refracturedgames.com`, `Subject: bug-tectolite`, and body
    containing the form content + app info.
14. Manual test: leave description empty, click "Send Report" →
    validation error, no mail client opened.
15. Manual test: click "Cancel" → modal closes, nothing happens.
16. Manual test: enter email, send report, reopen dialog → email field
    is pre-filled from localStorage.
17. Manual test: uncheck screenshot, send report → no screenshot
    captured, mail client opens normally.

## Non-goals

- **No server-side bug submission endpoint.** This brief uses `mailto:`
  only. A future brief could add a REST endpoint or a GitHub-issue
  template auto-fill via the GitHub API.
- **No direct file attachment to email.** The `mailto:` protocol cannot
  attach files. The screenshot is copied to clipboard (or downloaded as
  a file) and the user pastes/attaches it manually in their mail client.
  A future server-side endpoint could support direct attachment.
- **No legend button.** The user mentioned "right of legend button" but
  the legend button doesn't exist yet (planned in BRIEF_03/BRIEF_06).
  The bug button goes at the end of header-actions instead. When the
  legend button is added, it can be placed before the bug button.
- **No automated error/crash reporting.** This is a manual user-initiated
  bug report, not a crash reporter or telemetry system.
- **No new CSS classes.** The button and modal use existing styles.
- **No Electron IPC changes.** `navigator.clipboard.write()` works
  without IPC. Adding `clipboard` IPC is a possible enhancement but is
  out of scope.

## Degraded-path expectations

- **No mail client configured**: `window.open('mailto:...')` returns
  `null` or opens a blank window. Show a fallback message in the modal:
  "Could not open your email client. Please manually email
  mail@refracturedgames.com with subject 'bug-tectolite'."
- **`mailto:` body truncated by client**: Acceptable — the user sees the
  pre-filled email and can review/adjust before sending. The app-info
  block is small enough to survive most truncation limits.
- **Electron `window.open` blocked**: Electron may block `window.open`
  in some configurations. If `window.open` returns `null`, show the
  fallback message. As a secondary fallback, set `window.location.href`
  to the `mailto:` URL (this works in some Electron configs where
  `window.open` doesn't).

## Verification gates and report format

Run all three gates and capture the final output lines:

```
npx tsc --noEmit
npx vitest run
npx vite build
```

Report format:
- **What changed**: exact file paths and line numbers for each edit.
- **What was verified**: each gate with its output summary.
- **What needs manual verification**: the 5 manual test criteria above
  (items 9–13) — these require a running app and a configured mail
  client.
- **Assumptions still unverified**: any LEDGER entries not confirmed.
- **Out-of-scope findings**: anything noticed but not fixed.

## Authority boundaries

- **Do NOT commit.** Leave changes uncommitted for the user to review.
- **Do NOT modify `electron-main.cjs` or `preload.cjs`.** The `mailto:`
  approach and `navigator.clipboard` work without IPC changes. Adding an
  IPC channel for `shell.openExternal` or `clipboard` is a possible
  enhancement but is out of scope.
- **Do NOT add npm dependencies.** No email or clipboard library is
  needed.
- **Do NOT create new files.** All changes go in existing files
  (`vite.config.ts`, `src/types.ts`, `src/canvas/CanvasManager.ts`,
  `src/ui/AppTemplate.ts`, `src/main.ts`). The method goes on the
  existing `TectoLiteApp` class.
- **Stopping rule**: if `showModal` cannot be used for a form with
  post-render value reading (e.g. the dialog DOM isn't queryable after
  `showModal` returns), stop and report — don't build a parallel modal
  system. Probe this before implementing by reading `showModal`'s code.

## Decision log

| Fork | Decision | Why |
|---|---|---|
| Button placement: "right of legend" vs end of header-actions | End of header-actions | No legend button exists; end of header-actions is the rightmost position |
| Email mechanism: `mailto:` vs IPC `shell.openExternal` vs HTTP endpoint | `mailto:` via `window.open` | No backend, no IPC channel, works in web + Electron, zero dependencies |
| Form display: `showModal` vs new inline modal vs Electron dialog | `showModal` from `ModalSystem.ts` | Existing reusable modal; no new infrastructure; consistent with other dialogs |
| Version string source: `package.json` vs Vite `define` vs hardcoded constant | Vite `define` with `__APP_VERSION__` | Auto-updates from `package.json` on every build; no manual constant to maintain |
| Body content: user fields only vs user fields + app info | User fields + app info | App version/platform/UA helps diagnose bugs without asking the user |
| Email persistence: localStorage vs save file vs none | localStorage (`tectolite-bug-email`) | Per-user convenience; doesn't pollute save files; follows existing localStorage patterns |
| Screenshot delivery: clipboard vs download vs none | Clipboard with download fallback | `mailto:` can't attach files; clipboard lets user paste into email; download covers clipboard failure |
| Screenshot capture: DOM `getElementById` vs `CanvasManager` getter | `CanvasManager.captureScreenshot()` method | Encapsulates canvas access; survives future canvas structure changes (e.g. WebGL in TASK_21) |