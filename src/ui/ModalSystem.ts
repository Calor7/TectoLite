/**
 * ModalSystem - Generic modal dialog and theme toggle.
 * Extracted from main.ts TectoLiteApp class.
 */
import { uiIcon } from './icons';

export interface ModalButton {
    text: string;
    subtext?: string;
    isSecondary?: boolean;
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

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'area[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'iframe',
    'object',
    'embed',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

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

function getCurrentFocusTarget(): HTMLElement | null {
    return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function getRestoreFocusTarget(element: HTMLElement | null): HTMLElement | null {
    if (!element) return null;
    const closedHeaderMenu = element.closest<HTMLElement>('.view-dropdown-menu:not(.show)');
    if (!closedHeaderMenu) return element;

    const trigger = closedHeaderMenu.parentElement?.querySelector<HTMLElement>(
        `:scope > button[aria-controls="${closedHeaderMenu.id}"]`
    );
    return trigger ?? element;
}

function isFocusableVisible(element: HTMLElement): boolean {
    if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return false;
    if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;

    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
    return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isFocusableVisible);
}

function focusInitialElement(dialog: HTMLElement, body: HTMLElement, secondaryButtons: HTMLButtonElement[]): void {
    const autofocusTarget = dialog.querySelector<HTMLElement>('[autofocus]');
    const bodyTarget = getFocusableElements(body)[0];
    const safeSecondary = secondaryButtons.find(button => button.dataset.safeDismiss === 'true');
    const target = autofocusTarget && isFocusableVisible(autofocusTarget)
        ? autofocusTarget
        : bodyTarget ?? safeSecondary ?? dialog;
    target.focus({ preventScroll: true });
}

/**
 * Shows one accessible modal dialog. Calling showModal while another managed
 * modal is open replaces the old one rather than stacking two modal layers.
 */
export function showModal(options: ModalOptions): void {
    const restoreTarget = activeModal?.restoreTarget ?? getCurrentFocusTarget();
    activeModal?.close(false);

    const instanceId = ++modalId;
    const titleId = `app-modal-title-${instanceId}`;
    const descriptionId = `app-modal-description-${instanceId}`;
    const previousBodyOverflow = document.body.style.overflow;

    const overlay = document.createElement('div');
    overlay.className = 'app-modal-overlay';
    overlay.dataset.managedModal = 'true';

    const dialog = document.createElement('div');
    dialog.className = 'app-modal-dialog';
    dialog.tabIndex = -1;
    dialog.style.setProperty('--app-modal-width', options.width || '400px');
    for (const [name, value] of Object.entries(getModalDialogAttributes(titleId, descriptionId))) {
        dialog.setAttribute(name, value);
    }

    const title = document.createElement('h3');
    title.id = titleId;
    title.className = 'app-modal-title';
    title.textContent = options.title;

    const body = document.createElement('div');
    body.id = descriptionId;
    body.className = 'app-modal-body';
    // Modal content is deliberately rich HTML supplied by trusted application
    // callers. User-controlled values must be escaped by those callers.
    body.innerHTML = options.content;

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'app-modal-actions';

    dialog.append(title, body, buttonContainer);
    overlay.appendChild(dialog);

    const primaryButtons = options.buttons.filter(button => !button.isSecondary);
    const secondaryOptions = options.buttons.filter(button => button.isSecondary);
    const secondaryElements: HTMLButtonElement[] = [];
    let closed = false;

    const close = (shouldRestoreFocus: boolean): void => {
        if (closed) return;
        closed = true;
        overlay.remove();
        document.body.style.overflow = previousBodyOverflow;
        if (activeModal?.close === close) activeModal = null;

        const focusTarget = getRestoreFocusTarget(restoreTarget);
        if (shouldRestoreFocus && focusTarget?.isConnected) {
            focusTarget.focus({ preventScroll: true });
        }
    };

    const runAction = (button: ModalButton): void => {
        const result = button.onClick();
        if (result !== false) close(true);
    };

    const createButton = (button: ModalButton, secondary: boolean): HTMLButtonElement => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = secondary ? 'btn btn-secondary app-modal-secondary' : 'btn app-modal-primary';
        element.addEventListener('click', () => runAction(button));

        if (secondary) {
            element.textContent = button.text;
            element.dataset.safeDismiss = String(isSafeImplicitDismissAction(button));
        } else {
            const label = document.createElement('span');
            label.className = 'app-modal-button-label';
            label.textContent = button.text;
            element.appendChild(label);

            if (button.subtext) {
                const subtext = document.createElement('span');
                subtext.className = 'app-modal-button-subtext';
                subtext.textContent = button.subtext;
                element.appendChild(subtext);
            }
        }
        return element;
    };

    for (const button of primaryButtons) {
        buttonContainer.appendChild(createButton(button, false));
    }

    if (secondaryOptions.length > 0) {
        const secondaryRow = document.createElement('div');
        secondaryRow.className = 'app-modal-secondary-row';
        for (const button of secondaryOptions) {
            const element = createButton(button, true);
            secondaryElements.push(element);
            secondaryRow.appendChild(element);
        }
        buttonContainer.appendChild(secondaryRow);
    }

    const dismissImplicitly = (): void => {
        if (!canImplicitlyDismiss(options.buttons)) return;
        const safeAction = secondaryOptions.find(isSafeImplicitDismissAction);
        if (safeAction) runAction(safeAction);
        else close(true);
    };

    overlay.addEventListener('click', event => {
        if (event.target === overlay) dismissImplicitly();
    });

    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape' && canImplicitlyDismiss(options.buttons)) {
            event.preventDefault();
            event.stopPropagation();
            dismissImplicitly();
            return;
        }

        if (event.key !== 'Tab') return;
        const focusable = getFocusableElements(dialog);
        event.preventDefault();
        const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
        const nextIndex = getWrappedFocusIndex(currentIndex, focusable.length, event.shiftKey);
        if (nextIndex >= 0) focusable[nextIndex].focus({ preventScroll: true });
        else dialog.focus({ preventScroll: true });
    });

    activeModal = { restoreTarget, close };
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);
    focusInitialElement(dialog, body, secondaryElements);
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
