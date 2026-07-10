# BRIEF_06 — UI information architecture + modal unification

Release: v0.4.0 "The Author's Cut" · Size: M · Absorbs TASK_13

## Goal and why

The UI grew feature-by-feature and it shows: the title bar crams brand,
ko-fi, and subscribe links next to nine action buttons; "Settings" vs
"View" split leaks implementation history (Oceanic Crust *settings* live in
Settings, oceanic *opacity* also in Settings, but plate opacity in View);
seven separate modal implementations exist; hotkeys exist but are only
discoverable by hovering every (i) icon. None of this blocks a power user —
all of it taxes every new user and every new feature (each addition asks
"which menu?" and gets a different answer).

This brief establishes the menu taxonomy, consolidates modals into one
manager, and adds a hotkey cheat sheet. It is IA and plumbing — visual
style (inline-styles extraction) stays TASK_14, and no framework is
introduced.

## The map

- Template: `src/ui/AppTemplate.ts` — entire header + dropdowns (lines
  24–307), toolbar, panels. This is where structure changes.
- Handlers: `src/main.ts` `setupEventListeners()` — every menu item has a
  listener here; moving a control means moving nothing *logical*, only
  re-anchoring ids (keep ids stable wherever possible; they're the test
  hooks per README SEO/semantics norms).
- Modals today (the 7 paths TASK_13 catalogs): time-input modal +
  apply-edit modal + drag-target modal (static HTML in `AppTemplate.ts`
  561–631), `showModal`/`showLegendDialog` (`src/ui/ModalSystem.ts`),
  export/import dialogs (`src/export.ts`), tutorial overlay
  (`src/ui/TutorialOverlay.ts`). Read TASK_13
  (`docs/restructure-tasks/TASK_13_unify_modals.md`) — its ModalManager
  design is approved; implement it as written, then port the static
  modals onto it.
- `syncUIToState` in `main.ts` — any moved toggle must keep sync working.

## Target taxonomy (the decision, pre-made)

Header, left→right:
- **Brand block**: "TECTOLITE" + tiny "by RefracturedGames". Ko-fi +
  subscribe move into Help.
- **File**: Save (JSON), Load, Export… (unified dialog), autosave-restore
  entry point if present.
- **View**: Panels (Tools/Plates/Properties/Timeline), Projection, Camera
  views, Reference overlay, all canvas display toggles (grid, features,
  Euler poles, links, velocity arrows, hover tooltips, hidden plates, grid
  on top, plate opacity, future: seafloor age).
- **Simulation** (rename of the current Settings dropdown's sim half):
  Timeline max duration, planet radius, Oceanic Crust group (expanding
  rifts, auto-generate, interval, color/opacity, future: subduction),
  Automation & Events group (boundary viz, guided creation, pause on
  fusion, event icons).
- **Help**: Tutorial, Manual, Hotkey cheat sheet (new), Legend, About
  (brand/ko-fi/subscribe links live here), GitHub link.
- **Right-aligned buttons**: Undo, Redo, Theme, Fullscreen, Reset camera.

Line Entity Defaults stay in Simulation (they configure authored-entity
defaults, not view state).

## Work items

1. Implement TASK_13's `ModalManager` (one overlay, focus trap, Esc/Enter
   conventions, promise-based `confirm`/`prompt` replacements); port the
   three static modals + `ModalSystem` dialogs onto it; leave export.ts
   dialogs for a follow-up if the diff grows past reviewable (report if
   deferred).
2. Restructure the header per the taxonomy above in `AppTemplate.ts`;
   re-anchor listeners in `main.ts`; keep every existing element id.
3. Hotkey cheat sheet: `?` key + Help entry opens a ModalManager dialog
   listing tool hotkeys (V/H/D/E/S/L/G), timeline keys (Space, ←/→,
   Shift+←/→), camera keys (1–9, Shift+1–9). Source the list from one
   exported constant next to where hotkeys are bound so it can't drift.
4. `syncUIToState` audit after the move: every checkbox/select reflects
   state on load.

## Invariants and traps

- **Keep element ids stable.** Dozens of `getElementById` calls and the
  tutorial overlay's anchors depend on them. If an id must change, grep
  all of `src/` including `TutorialOverlay.ts` and `TutorialManual.html`.
- The tutorial overlay positions itself against real DOM nodes — run the
  tutorial after restructuring; broken anchors are a release blocker for
  this brief.
- Dropdown open/close behavior is hand-rolled — reuse the existing
  `view-dropdown-container` pattern for new menus; do not invent a second
  dropdown mechanism.
- `alert()` remains reserved for genuine errors; informational flows use
  toasts (existing convention).
- Do not change canvas rendering, tool behavior, or any simulation code.

## Decision log

- Five menus (File/View/Simulation/Help + brand) — chosen over a menubar
  rewrite; it's a re-grouping of existing dropdowns, not new chrome.
- Monetization links live in Help→About, visible but out of the title bar.
- ModalManager lands *with* the IA change (same brief) because moving
  modal triggers twice would double the churn.
- No Preact here — TASK_15 remains a separate fenced pilot.

## Acceptance criteria

- [ ] Every control reachable before is reachable after (walk the old
      AppTemplate section by section against the new — checklist in
      report).
- [ ] All modals open/close via ModalManager: Esc closes, focus returns to
      the invoker, no double-overlay possible.
- [ ] `?` opens the cheat sheet; every listed hotkey works as listed.
- [ ] Tutorial runs end-to-end without mis-anchored highlights.
- [ ] `syncUIToState` reflects a loaded save into every moved control.
- [ ] `npm run verify` + lint green; manual visual pass checklist supplied
      (menus in both themes, dropdown z-order over canvas).

## Non-goals

- No visual redesign/styling pass (TASK_14), no framework, no new
  features inside menus (seafloor-age/subduction toggles arrive with their
  own briefs), no export-dialog logic changes.

## Authority boundaries

No commits without user go-ahead. If porting export.ts dialogs would push
the diff past one reviewable session, defer them and say so rather than
splitting attention.

## Report format

Old-location → new-location table for every moved control; modal inventory
(path → ported/deferred); files changed; the manual visual checklist;
out-of-scope findings → `docs/restructure-tasks/out-of-scope-list`.
