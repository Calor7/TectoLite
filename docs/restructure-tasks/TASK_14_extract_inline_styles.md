# TASK_14 — Extract Inline Styles to CSS Classes

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

`src/ui/AppTemplate.ts` (~636 lines) is ~95% inline `style="..."` attributes. The HTML template is a giant string literal with inline styles on nearly every element. This makes theming, maintenance, and the dark/light toggle painful. `src/style.css` has CSS variables (`--bg-dark`, `--text-primary`, `--border-default`, etc.) and some classes (`.property-input`, `.property-color`, `.btn`, `.tool-select`), but layout is almost entirely inline.

## Task

### 1. Audit existing CSS classes
Read `src/style.css` fully. Catalog existing classes and CSS variables. Note which patterns are already classed (`.btn`, `.property-input`, `.property-label`, `.property-group`, `.tool-select`, `.view-dropdown-item`, `.dropdown-section`, `.dropdown-header`, etc.).

### 2. Catalog inline style patterns
Read `src/ui/AppTemplate.ts` and identify the most common repeated inline style patterns:
- `display: flex; justify-content: space-between; align-items: center;` → `.row-between`
- `display: flex; gap: 8px; align-items: center;` → `.row-gap`
- `font-size: 10px; color: var(--text-secondary);` → `.label-small`
- `font-size: 11px;` → `.text-sm`
- `padding: 2px 8px 4px 8px;` → `.pad-x-sm`
- `border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px;` → `.section-divider`
- `width: 100%;` → `.w-full`
- `display: flex; flex-direction: column; gap: 8px;` → `.col-gap`
- Settings row pattern (label + color input + select) → `.settings-row-line`
- etc.

### 3. Add utility + component classes to `src/style.css`
Add the cataloged patterns as CSS classes. Use the existing CSS variable system. Group them logically:
```css
/* === Layout Utilities === */
.row-between { display: flex; justify-content: space-between; align-items: center; }
.row-gap { display: flex; gap: 8px; align-items: center; }
.col-gap { display: flex; flex-direction: column; gap: 8px; }
.w-full { width: 100%; }
.pad-x-sm { padding: 2px 8px 4px 8px; }
.section-divider { border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px; }

/* === Typography === */
.label-small { font-size: 10px; color: var(--text-secondary); }
.text-sm { font-size: 11px; }

/* === Settings Rows === */
.settings-row { padding: 2px 8px 4px 8px; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.settings-row label { font-size: 10px; color: var(--text-secondary); flex: 1; }
.settings-color-input { width: 24px; height: 16px; border: none; padding: 0; background: none; cursor: pointer; }
.settings-select { width: 90px; font-size: 10px; padding: 1px; }
```

### 4. Replace inline styles in `AppTemplate.ts`
Go through `AppTemplate.ts` and replace inline `style="..."` attributes with the new classes. For one-off styles that don't repeat, keep them inline (don't over-class-ify). Focus on the **repeated patterns** from step 2.

**Do this incrementally** — section by section:
- Timeline section
- Planet section
- Oceanic Crust section
- Line Entity Defaults section
- Automation & Events section
- View dropdown sections
- Toolbar
- Sidebar
- Properties panel shell
- Timeline bar

### 5. Replace inline styles in other UI files
- `src/ui/ModalSystem.ts` — extract modal styling to `.modal-overlay`, `.modal-dialog`, `.modal-title`, `.modal-content`, `.modal-buttons`.
- `src/ui/SpeedPresets.ts` — extract preset list item styling.
- `src/main.ts` `updatePropertiesPanel()` — the ~250-line template literal has many inline styles. Replace with classes.
- `src/export.ts` — export/import dialog inline styles.

### 6. Verify dark/light theme still works
The `toggleTheme` function in `ModalSystem.ts` switches a `data-theme` attribute on `<html>`. Verify that the new classes use CSS variables (not hardcoded colors) so the theme toggle works. Test both themes.

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass
3. `npx vite build` — must pass
4. **Visual regression**: The app should look identical before and after (same layout, colors, spacing). Take screenshots or visually compare.
5. `grep -c "style=" src/ui/AppTemplate.ts` — should be significantly reduced (target: < 20 remaining inline styles, down from ~100+).
6. **Theme toggle**: Switch between dark and light themes — all new classes should adapt via CSS variables.

## Notes
- This is a **pure refactor** — no behavior change. The app should look identical.
- Don't create a class for every single inline style — only the repeated patterns. One-off styles can stay inline.
- Keep the CSS organized with section comments (`/* === Layout === */`, `/* === Settings === */`, etc.).
- The existing CSS variables (`--bg-dark`, `--bg-elevated`, `--text-primary`, `--text-secondary`, `--border-default`, `--accent-primary`, `--radius-sm`, etc.) should be reused — don't introduce new variables unless needed.
- This task is tedious but low-risk. If a visual difference appears, it's a CSS specificity or variable issue — fix it by matching the original inline value.


Note out of scope at the end findings and tasks and write them to docs\restructure-tasks\out-of-scope-list