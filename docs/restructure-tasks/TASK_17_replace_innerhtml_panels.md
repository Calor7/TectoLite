# TASK_17 — Replace innerHTML Panel Rebuilds with Targeted DOM Updates

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

Three panel methods rebuild their entire content via `innerHTML` on every refresh, causing focus loss and listener churn:
1. `updateExplorer()` (`src/main.ts` ~line 2692) — `list.innerHTML = ''` then rebuild
2. `updatePropertiesPanel()` (`src/main.ts` ~line 2937) — `content.innerHTML = \`...\`` (~250-line template)
3. `updateEdgePropertiesPanel()` (`src/main.ts` ~line 3550) — same pattern
4. `TimelineSystem.render()` (`src/systems/TimelineSystem.ts`) — full DOM rebuild

## Task

### If TASK_15 (Preact pilot) is done:
The properties panel is already Preact-based. Extend the Preact approach to the remaining panels:

#### 1. Explorer panel → Preact
Create `src/ui/ExplorerPanel.tsx`:
- Renders the plate list from a `plates` signal.
- Search box is a controlled Preact input — focus is preserved across re-renders.
- Filter checkboxes are Preact components bound to signals.
- Selection highlight updates via signal — no full rebuild.

Create `src/ui/explorerStore.ts` with signals: `plates`, `searchQuery`, `filterFlags`, `selectedPlateId`.

In `src/main.ts`, replace `updateExplorer()` with a signal sync: `explorerPlates.value = this.state.world.plates; selectedPlateId.value = this.state.world.selectedPlateId;`

#### 2. Edge properties panel → Preact
Create `src/ui/EdgePropertiesPanel.tsx` — shown when an edge is selected. Bound to an `selectedEdge` signal.

#### 3. Timeline panel → Preact
Create `src/ui/TimelinePanel.tsx` — renders the event list from a `timelineEvents` signal. Event editing (time, pole, rate) uses controlled inputs — focus preserved.

Update `src/systems/TimelineSystem.ts` to update signals instead of rebuilding DOM. Or replace `TimelineSystem` with the Preact component + a `TimelineController` (if TASK_16 is done).

### If TASK_15 (Preact pilot) is NOT done:
Use targeted DOM updates without a framework:

#### 1. Explorer panel — diff-update approach
Instead of `list.innerHTML = ''`, diff the list:
- Keep a `Map<plateId, HTMLElement>` of existing list items.
- On update: for each plate, if an item exists in the map, update its text content / class (selected/not). If not, create a new element and append. Remove elements for plates that no longer exist.
- Preserve the search box element — never destroy it. Update its value only if the user isn't focused on it.

#### 2. Properties panel — per-field updates
Instead of rebuilding the whole panel, update individual fields:
- Build the panel structure ONCE (on first selection or panel mount).
- On subsequent updates, find each input by ID and update its `value` / `checked` / `selected` property directly.
- Only rebuild the panel structure when the selected entity TYPE changes (plate → plume → edge → different plate type).
- This preserves focus on all inputs that aren't being changed.

#### 3. Timeline panel — diff-update
Same approach as explorer: keep a map of event ID → DOM element. Update existing, add new, remove stale.

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass
3. `npx vite build` — must pass
4. **Focus preservation test**: Type in the properties panel name field. Trigger a re-render (e.g. select a different plate then reselect). Focus and cursor position should be preserved (if using Preact) or at least not lost during typing (if using diff-update).
5. **Explorer test**: Type in the search box while plates are being updated. Focus should be retained.
6. `grep -c "innerHTML" src/main.ts` — should be significantly reduced.
7. **Manual test**: All panels render correctly, selection works, editing works.

## Notes
- **If TASK_15 is done**, this task is mostly "extend Preact to other panels" — straightforward.
- **If TASK_15 is NOT done**, the diff-update approach is more work but framework-free.
- The Preact approach is strongly preferred — it's less code, more maintainable, and solves focus preservation automatically.
- If TASK_16 (split main.ts) is done, the panel logic lives in `SelectionController` — update there.
- The explorer search box already has a focus-preservation workaround (`searchHadFocus` check). The Preact/diff approach makes this workaround unnecessary.


Note out of scope at the end findings and tasks and write them to docs\restructure-tasks\out-of-scope-list