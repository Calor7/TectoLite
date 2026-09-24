# App UI audit implementation — 24 September 2026

This implements the changes proposed in the TectoLite app audit. Existing project data and the original supplied 107-plate save are preserved. Recommendations to retain an effective pattern are recorded as preserved, rather than redesigned.

| Audit item | Delivered behavior |
| --- | --- |
| A01 — Brand and palette | Preserved the app palette and integrated the RefracturedGames monochrome SVG in the app identity and Help. |
| A02 — Shared fields | `Fields.ts` and `controls.css` supply themed controls, standard/compact density, focus, disabled and invalid states. |
| A03 — Typography | Inputs, selects and textareas inherit the app typeface. Standard fields use 14px; compact controls and supporting text use at least 12px. IDs retain monospace. |
| A04 — Dock headings | Unified heading typography, spacing and dividers; removed the repeated Select Options card heading. |
| A05 — Dialog family | Shared shell with compact confirmations, descriptive choices, forms and wide previews; consistent secondary and destructive actions. |
| A06 — Saving and recovery | Explicit saved/cancelled/download-started outcomes. Recovery clears only after a confirmed file write. Browser file-picker writes and Electron atomic writes report completion; unconfirmed downloads retain recovery. Failed writes report an error. |
| A07 — Dialog keyboard behavior | Focus stays in the dialog, including disclosure summaries; Escape/backdrop dismiss safely and return focus. Save, Import, Export, time entry, geometry/motion dialogs and Settings use the same behavior. |
| A08 — Undo and edits | Plate properties, label color gestures and Explorer visibility changes record history and mark the project unsaved. A color gesture creates one history entry. Undo/Redo also mark restored changes unsaved. |
| A09 — Field labels | Render boundaries associate labels with inputs, including generated Properties, Settings, export and Plate History fields. Explicit names cover composite speed and line-pattern controls. |
| A10 — Keyboard selection | The current time is a button. Explorer uses native selection buttons with arrow/Home/End navigation; pointer range selection and dragging remain available. |
| A11 — Filter feedback | Entity and group counts show matching/total counts. A selected entity outside the filter has a clear-filter action. The search field stays connected during typing and paste. Group-name and short-ID filtering are supported. |
| A12 — Visible relationships | Preserved prominent Follows/Followed by rows, destination selection and an unlink action for each relationship. Unlink retains earlier linked motion and is undoable. |
| A13 — Long names | Link rows include short IDs, color cues and keyboard-accessible full-name/ID disclosures. Explorer rows include short IDs. New split/fuse names are capped at 64 characters; existing names are unchanged. |
| A14 — Easier following | Selected plate → Follow another plate… → choose leader on map or in Explorer → review direction/time. Leader-first linking remains available. Creation rejects lifetime/cycle violations. Replacing an existing saved relationship explicitly explains its history consequences. |
| A15 — Tool guidance | Preserved task-specific tool options and descriptions within the common field/header treatment. |
| A16 — Project export shortcut | Editable project opens the Save form directly. Preserved format explanations, export presets and map preview. |
| A17 — Validation | Save/time/report fields and export dimensions show textual errors and invalid semantics. Invalid PNG dimensions label the retained image “Last valid preview”; field borders identify invalid dimensions. |
| A18 — Startup/import | Preserved explicit template/import choices and import modes within the shared dialog shell. |
| A19 — Narrow docks | At 760px and below, one active sheet shows Explorer, Properties, History or Tool Options. Close returns to the canvas. Desktop docks remain independent. Filter and selection survive sheet changes. |
| A20 — Timeline fit | Narrow layouts put the slider on its own row and keep time, Ma, history and reset controls separate. |
| A21 — Tool discovery | A named Tools chooser exposes every tool at narrow widths; the active tool scrolls into view on selection and resize. |
| A22 — Settings organization | Detailed appearance/reference controls moved from View into Settings, with expandable sections. View retains workspace/display controls, projection, camera views and narrow-screen window commands. |
| A23 — Help icons | Standard outline information icons replace textual “(i)” indicators, with keyboard help. |
| A24 — Manual highlights | Quiet informational outlines replace pulsing red glows. Focus/hover emphasizes the relevant target and displays its explanation. The manual has a Close button, focus containment and Escape. |
| A25 — Help/report forms | Preserved content and layout, applied shared controls/actions, and added inline required-description feedback. No report was submitted. |
| A26 — Empty states | Preserved contextual empty states and added the empty-history instruction. |
| A27 — Timeline behavior | Preserved playback/stepping labels and exact time entry; invalid time has inline feedback. |
| A28 — Editing header | Support and app-download links moved into Help; the editing header no longer presents a prominent distribution CTA. |

## Shared implementation contracts

- Call `prepareFields` after rendering an app-owned form surface. It associates visible labels, applies density styles and supplies inline validation. Spinner step sizes do not prohibit fractional simulation values.
- Use `mountDialogSurface` for custom forms/previews or `showModal` for confirmations and choices. Fixed legacy dialogs use `openFixedDialog`/`closeFixedDialog`.
- Record history before mutating project properties. Record a live color gesture once, not for every intermediate color.
- A save notification must follow a confirmed write. Download initiation is not proof of file completion; recovery remains available.
- Follow relationships use **leader** and **follower** in the UI. Internal parent/child domain names remain unchanged.

## Verification

- Full suite: **220 tests passed across 38 files**, including saving cancellation/failure/recovery checks and the prior link-history regressions.
- TypeScript and Electron main/preload syntax checks passed. ESLint has no errors; existing repository warnings remain. Production build passed with the existing large-bundle advisory.
- Browser testing used the supplied 107-plate project at **620 Ma**. Verified filtered 1-of-107 counts, keyboard selection, property Undo/Redo, unlink/Undo, follower-first creation/Undo, save cancellation with recovery retained, invalid filename, focus wrapping/restoration, direct Editable project → Save, invalid PNG preview labeling, time validation, and focused manual explanations.
- Verified single-sheet navigation and non-overlapping timeline controls at **390px and 320px**, active-tool visibility after resizing, and desktop light/dark rendering. A fresh session offered the retained recovery project.
- Screenshots are in the task artifact folder `app-audit/implemented`.

## Practical limits

The original reporter's precise linking symptom at 620 Ma is still unknown. These checks establish the observed behavior; they do not identify that unreported symptom. The file format stores one saved follow relationship per plate, so replacing it can rewrite earlier linked history; the review dialog now says so. Unlinking preserves earlier history.

Native operating-system save dialogs and packaged Electron builds on every supported OS were not exercised. Save outcomes and failure handling have automated coverage. This is not a complete screen-reader, touch-hardware, forced-colors or accessibility certification pass; the audit's broader exploratory checks remain appropriate release QA.
