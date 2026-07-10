# BRIEF_07 — First-run experience: example worlds, welcome flow, tutorial refresh

Release: v0.4.0 "The Author's Cut" · Size: M

## Goal and why

Today a new user gets a blank sphere and a tutorial overlay. The fastest
"wow" this app can deliver is a *living world*: press play, watch continents
drift, rifts open, oceans spread — then start meddling. Curated example
worlds also serve as living documentation (each demonstrates a mechanic)
and as regression fixtures (they load through the real migration path).

Deliverables: 2–3 bundled example worlds, a welcome dialog offering
Blank / Example / Load, and a tutorial pass to re-align content with the
current UI.

## The map

- Save/load pipeline: `src/export.ts` (`parseImportFile`) →
  `src/migration.ts` (`migrateSaveFile`, `CURRENT_SAVE_VERSION = 4`) →
  world replacement in `main.ts`. Bundled examples go through the *same*
  pipeline — imitate the import handler's replace-current path, minus the
  file picker.
- Autosave restore: `offerAutosaveRestore()` in `main.ts` (~line 220)
  runs at startup — the welcome flow must compose with it (see decisions).
- Tutorial: `src/ui/TutorialOverlay.ts` + `src/ui/TutorialManual.html` —
  audit anchors/ids and content against the current app (it predates
  several UI changes; the "Ago" era left scars everywhere).
- Asset bundling: Vite static assets — put worlds in
  `src/assets/examples/*.json` imported via `?raw` or `import.meta.glob`,
  so they ship in both web and Electron builds without fetch-path issues
  (**probe**: confirm the Electron `homepage: "./"` relative-path build
  serves bundled assets the same way; if not, inline as TS modules).
- First-run detection: localStorage — find the key conventions used by
  autosave/tutorial (grep `localStorage` in `main.ts`,
  `TutorialOverlay.ts`) and follow them.

## Work items

1. **Author 2–3 example worlds** (this is content work — do it in the app,
   export JSON, then curate):
   - *Rift & Drift* (~150 Ma): one continent splits, expanding rifts on,
     ocean opens with visible age gradient (uses BRIEF_03 if landed).
   - *Collision Course* (~100 Ma): two continents converge, committed
     orogeny event, mountain belt.
   - *Wilson* (~300 Ma, stretch goal): open then close an ocean
     (showcases subduction if BRIEF_04 landed; otherwise cut it).
   Keep each under ~200 KB; name plates properly; set a bookmark-worthy
   starting camera.
2. **Welcome dialog** (via BRIEF_06's ModalManager if landed; else
   `ModalSystem.showModal`): shown when no autosave exists and no world is
   loaded — three columns: Blank World / example cards (name, one-line
   pitch, tiny thumbnail) / Load File. Checkbox "Show on startup"
   (default on), persisted in localStorage (not in save files).
3. **Load-example plumbing**: dedicated `loadExampleWorld(json)` that runs
   migration + replaces world + jumps to `currentTime = 0` + resets
   camera to the world's saved view + pushes one history entry ("Loaded
   example").
4. **Tutorial refresh**: walk every tutorial step against the live UI; fix
   stale ids/labels/claims; add one final step pointing at the welcome
   dialog's examples ("load a finished world to see where this goes").

## Invariants and traps

- **Startup precedence**: autosave-restore prompt WINS over the welcome
  dialog (never stack modals). Order: autosave exists → offer restore
  (decline = show welcome); no autosave → welcome.
- Examples must be **valid v4 saves** (export them from the running app,
  never hand-write), yet still get piped through `migrateSaveFile` on load
  — that keeps them working as fixtures when v5 arrives.
- Loading an example must be undoable and must not clobber an unsaved
  user world silently — if plates exist and history is non-empty, confirm
  first ("Replace current world?").
- `timelineMaxTime` and globalOptions travel inside the save — curate them
  per example (e.g. Rift & Drift caps at 200 Ma so the slider fits the
  story).
- Electron + web both: verify the welcome flow in `npm run dev` AND a
  production `npm run preview` build (asset paths differ — that's the
  probe above).

## Decision log

- Examples are bundled assets, not remote fetches — offline-first, no
  CDN, no version skew.
- Welcome shows when: no autosave AND (first run OR "show on startup"
  enabled). A returning user with autosave never sees it uninvited; a
  Help-menu "Welcome / Examples…" entry reopens it on demand.
- Thumbnails: pre-rendered small PNGs bundled next to the JSON (a canvas
  render at load time would delay the dialog).
- 2 worlds ship minimum; the Wilson world is cut without ceremony if
  BRIEF_04 hasn't landed or authoring exceeds the session.

## Acceptance criteria

- [ ] Cleared localStorage + `npm run dev` → welcome dialog; picking an
      example gives a playable world in <2 s; play shows the intended
      story.
- [ ] Autosave present → restore prompt only; declining shows welcome.
- [ ] Loading an example over a dirty world asks first; undo restores the
      previous world.
- [ ] Each example survives export → reimport roundtrip unchanged.
- [ ] Tutorial completes with every highlight anchored to a real element.
- [ ] `npm run verify` + lint green; works in `npm run preview` build.

## Non-goals

- No in-app example browser/gallery beyond the dialog, no remote example
  hosting, no localization, no video/gif tutorials, no changes to autosave
  mechanics themselves.

## Authority boundaries

No commits without user go-ahead. Example-world *content* (names, story
beats) is creative work the user may want to redo — deliver them as
drafts and say so explicitly.

## Report format

Files changed + assets added (with sizes); startup-flow truth table
(autosave × first-run × setting → what shows); tutorial steps fixed;
example-world authoring notes for the user to review/replace;
out-of-scope findings → `docs/restructure-tasks/out-of-scope-list`.
