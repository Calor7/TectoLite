# TASK_13 — Unify 7 Modal Code Paths into One ModalManager

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

There are **7 separate modal/overlay implementations** with no unified manager:
1. 4 modals hardcoded in `src/ui/AppTemplate.ts` (around lines 720-800): `time-input-modal`, `apply-edit-modal`, `drag-target-modal`, plus dropdown menus — toggled via `style.display`.
2. `src/ui/ModalSystem.ts` `showModal()` — builds disposable overlays via DOM API + `innerHTML` for body.
3. `src/ui/SpeedPresets.ts` `showPresetInfoDialog()` — rolls its own overlay via DOM API.
4. `src/export.ts` `showExportDialog()` / `showImportDialog()` — two more ad-hoc overlay builders.

Problems: no modal stack, z-fighting risk, no ESC-to-close, inconsistent styling, duplicated overlay logic.

## Task

### 1. Read all 7 modal implementations
Read and understand each:
- `src/ui/ModalSystem.ts` (the closest to a real manager — ~120 lines)
- `src/ui/AppTemplate.ts` lines ~720-800 (inline modals)
- `src/ui/SpeedPresets.ts` `showPresetInfoDialog`
- `src/export.ts` `showExportDialog` and `showImportDialog`

### 2. Create a unified `ModalManager`
Create `src/ui/ModalManager.ts`:

```typescript
export interface ModalButton {
    text: string;
    subtext?: string;
    onClick?: () => void;
    variant?: 'primary' | 'secondary' | 'danger';
    dismissOnClick?: boolean; // default true
}

export interface ModalOptions {
    title: string;
    content: string; // HTML string
    buttons?: ModalButton[];
    dismissable?: boolean; // can close via ESC / backdrop click (default true)
    onDismiss?: () => void;
    width?: string; // CSS width, default '400px'
}

export class ModalManager {
    private stack: { overlay: HTMLElement; options: ModalOptions }[] = [];

    open(options: ModalOptions): void {
        // Create overlay + dialog, append to body, push to stack
        // Handle ESC key (closes top modal if dismissable)
        // Handle backdrop click (closes top modal if dismissable)
        // Style consistently with existing ModalSystem look
    }

    close(): void {
        // Close top modal, call onDismiss, pop from stack
    }

    closeAll(): void {
        // Close all modals in the stack
    }

    get depth(): number { return this.stack.length; }
}

export const modalManager = new ModalManager(); // singleton
```

### 3. Port `ModalSystem.showModal` to use `ModalManager`
Update `src/ui/ModalSystem.ts` `showModal()` to delegate to `modalManager.open()`. Keep the `showModal` function signature as a compatibility wrapper so existing call sites don't break:
```typescript
export function showModal(options: { title: string; content: string; buttons: any[] }): void {
    modalManager.open({
        title: options.title,
        content: options.content,
        buttons: options.buttons.map(b => ({ text: b.text, subtext: b.subtext, onClick: b.onClick, variant: b.variant, dismissOnClick: true })),
    });
}
```

### 4. Port `SpeedPresets.showPresetInfoDialog` to use `ModalManager`
Replace the ad-hoc overlay logic with `modalManager.open()`.

### 5. Port `export.ts` dialogs to use `ModalManager`
Replace `showExportDialog` and `showImportDialog` ad-hoc overlay builders with `modalManager.open()`. These return Promises — use the `onDismiss` / button `onClick` to resolve/reject the promise.

### 6. Port inline modals from `AppTemplate.ts`
The 4 inline modals (`time-input-modal`, `apply-edit-modal`, `drag-target-modal`, dropdown menus) are toggled via `style.display` in the template. Convert them to use `modalManager.open()` instead:
- Remove the inline modal HTML from `AppTemplate.ts`.
- Update the handlers in `src/main.ts` that show/hide these modals to call `modalManager.open()` with the appropriate content/buttons.
- The dropdown menus (planet, view) are NOT modals — leave them as dropdowns. Only convert the actual modals.

### 7. Add ESC key handling
`ModalManager` should listen for ESC and close the top modal (if `dismissable`). Add a single `document.addEventListener('keydown')` listener in the constructor.

### 8. Add z-index stack management
Each modal in the stack gets an incrementing z-index (e.g. base 10000 + stack depth). This prevents z-fighting when modals overlap.

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass
3. `npx vite build` — must pass
4. `grep -r "createElement.*overlay\|createElement.*backdrop\|appendChild.*overlay" src/` — should only appear in `ModalManager.ts`
5. **Manual test**: Open a modal, press ESC — should close. Open a modal from within a modal — should stack with correct z-index. Click backdrop — should close top modal.
6. **Manual test**: All existing modal flows still work: time input, apply edit, drag target, export dialog, import dialog, preset info, autosave restore prompt.

## Notes
- Keep `ModalSystem.showModal` as a thin wrapper so existing call sites in `main.ts` don't need to change all at once.
- The dropdown menus in `AppTemplate.ts` (planet settings, view options) are NOT modals — they're dropdown toggles. Leave them alone.
- The `ModalManager` singleton is fine for this app (single window). If multi-window support is ever needed, instantiate per window.
- Style the modal consistently with the existing `ModalSystem` look (dark theme, rounded corners, etc.) — reuse the CSS classes from `style.css` if they exist, or add new ones.