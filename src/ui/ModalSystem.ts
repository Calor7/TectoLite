/**
 * ModalSystem - Generic modal dialog and theme toggle.
 * Extracted from main.ts TectoLiteApp class.
 */
import { mountDialogSurface } from './DialogSurface';
import { uiIcon } from './icons';

export interface ModalButton {
    text: string;
    subtext?: string;
    isSecondary?: boolean;
    danger?: boolean;
    onClick: () => boolean | void;
}

export interface ModalOptions {
    title: string;
    content: string;
    width?: string;
    buttons: ModalButton[];
}

interface ActiveModal {
    restoreTarget: HTMLElement | null;
    close: (restoreFocus: boolean) => void;
}

let modalId = 0;
let activeModal: ActiveModal | null = null;

/** @internal Exported so the keyboard contract can be tested without a DOM shim. */
export function getWrappedFocusIndex(currentIndex: number, focusableCount: number, backwards: boolean): number {
    if (focusableCount <= 0) return -1;
    if (currentIndex < 0) return backwards ? focusableCount - 1 : 0;
    if (backwards) return currentIndex === 0 ? focusableCount - 1 : currentIndex - 1;
    return currentIndex === focusableCount - 1 ? 0 : currentIndex + 1;
}

/** @internal Shared by showModal and focused accessibility tests. */
export function getModalDialogAttributes(titleId: string, descriptionId: string): Record<string, string> {
    return {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        'aria-describedby': descriptionId
    };
}

/**
 * Implicit dismissal must never run a potentially destructive secondary action.
 * Escape/backdrop still close a modal that has another secondary choice, but only
 * familiar cancellation labels receive their callback.
 *
 * @internal Exported for contract tests.
 */
export function isSafeImplicitDismissAction(button: ModalButton): boolean {
    return Boolean(button.isSecondary && /^(cancel|close|back|not now)$/i.test(button.text.trim()));
}

/** @internal Escape and backdrop clicks are available only with an alternate action. */
export function canImplicitlyDismiss(buttons: ModalButton[]): boolean {
    return buttons.some(button => button.isSecondary);
}

/** Shared shell with explicit compact-action and descriptive-choice variants. */
export function showModal(options: ModalOptions): void {
    const restoreTarget = activeModal?.restoreTarget ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    activeModal?.close(false);
    const id = ++modalId;
    const overlay = document.createElement('div');
    const dialog = document.createElement('div');
    const primary = options.buttons.filter(button => !button.isSecondary);
    const choices = primary.length > 1 || options.buttons.some(button => Boolean(button.subtext));
    dialog.className = choices ? 'app-modal-choices' : 'app-modal-compact';
    for (const [name, value] of Object.entries(getModalDialogAttributes('app-modal-title-' + id, 'app-modal-description-' + id))) dialog.setAttribute(name, value);
    const title = document.createElement('h3');
    title.id = 'app-modal-title-' + id;
    title.textContent = options.title;
    const body = document.createElement('div');
    body.id = 'app-modal-description-' + id;
    body.className = 'app-modal-body';
    // Callers escape user-controlled values before supplying rich content.
    body.innerHTML = options.content;
    const actions = document.createElement('div');
    actions.className = 'app-modal-actions';
    dialog.append(title, body, actions);
    overlay.appendChild(dialog);
    let closeSurface: (restore?: boolean) => void = () => undefined;
    let closed = false;
    const close = (restore = true) => {
        if (closed) return;
        closed = true;
        closeSurface(restore);
        if (activeModal?.close === close) activeModal = null;
    };
    const run = (button: ModalButton) => {
        if (button.onClick() !== false) close();
    };
    const ordered = choices ? options.buttons : [...options.buttons.filter(button => button.isSecondary), ...primary];
    for (const option of ordered) {
        const button = document.createElement('button');
        button.type = 'button';
        const destructive = option.danger ?? /^(delete|remove|discard|erase)\b/i.test(option.text);
        button.className = 'btn ' + (destructive ? 'btn-danger' : option.isSecondary ? 'btn-secondary' : choices ? 'app-modal-choice' : 'btn-primary');
        button.dataset.safeDismiss = String(isSafeImplicitDismissAction(option));
        const label = document.createElement('span');
        label.textContent = option.text;
        button.appendChild(label);
        if (option.subtext) {
            const detail = document.createElement('span');
            detail.className = 'app-modal-button-subtext';
            detail.textContent = option.subtext;
            button.appendChild(detail);
        }
        button.addEventListener('click', () => run(option));
        actions.appendChild(button);
    }
    activeModal = { close, restoreTarget };
    closeSurface = mountDialogSurface(overlay, dialog, {
        restoreTarget, width: options.width ?? '480px', canDismiss: canImplicitlyDismiss(options.buttons),
        initialFocus: body.querySelector<HTMLElement>('input:not(:disabled), textarea, select, button')
            ?? actions.querySelector<HTMLElement>('[data-safe-dismiss="true"]'),
        cancel: () => {
            const safe = options.buttons.find(isSafeImplicitDismissAction);
            if (safe) run(safe); else close();
        }
    });
}

/**
 * Toggles between light and dark theme, persists to localStorage, and updates icon.
 */
export function toggleTheme(callbacks: {
    setTheme: (theme: string) => void;
    render: () => void;
}): void {
    const isDark = document.body.getAttribute('data-theme') !== 'light';
    const newTheme = isDark ? 'light' : 'dark';

    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);

    callbacks.setTheme(newTheme);

    const btn = document.getElementById('btn-theme-toggle');
    if (btn) {
        const icon = btn.querySelector<HTMLElement>('[data-theme-icon]');
        if (icon) icon.innerHTML = uiIcon(newTheme === 'light' ? 'sun' : 'moon');
    }

    callbacks.render();
}
