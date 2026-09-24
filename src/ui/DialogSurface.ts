import { prepareFields } from './Fields';

const focusSelector = 'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])';

export function restoreDialogFocus(target: HTMLElement | null): void {
    const menu = target?.closest<HTMLElement>('.view-dropdown-menu:not(.show)');
    const trigger = menu?.parentElement?.querySelector<HTMLElement>(`button[aria-controls="${menu.id}"]`);
    const visible = trigger ?? target;
    if (visible?.isConnected) visible.focus({ preventScroll: true });
}

/** Shared focus, dismissal and visual contract for every app dialog. */
export function mountDialogSurface(overlay: HTMLElement, dialog: HTMLElement, options: {
    cancel: () => void;
    initialFocus?: HTMLElement | null;
    canDismiss?: boolean;
    persistent?: boolean;
    width?: string;
    restoreTarget?: HTMLElement | null;
}): (restore?: boolean) => void {
    const restoreTarget = options.restoreTarget ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const overflow = document.body.style.overflow;
    overlay.classList.add('app-modal-overlay');
    overlay.dataset.managedModal = 'true';
    overlay.style.cssText = 'display: flex';
    dialog.classList.add('app-modal-dialog');
    dialog.style.cssText = '';
    dialog.style.setProperty('--app-modal-width', options.width ?? '480px');
    dialog.tabIndex = -1;
    if (overlay !== dialog && overlay.getAttribute('role') === 'dialog') {
        for (const name of ['role', 'aria-modal', 'aria-labelledby', 'aria-describedby']) {
            const value = overlay.getAttribute(name);
            if (value) dialog.setAttribute(name, value);
            overlay.removeAttribute(name);
        }
    }
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = dialog.querySelector('h3');
    if (title) { title.classList.add('app-modal-title'); title.removeAttribute('style'); }
    dialog.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
        if (button.classList.contains('format-btn')) return;
        button.classList.add('btn');
        if (/cancel|close/i.test(button.id)) button.classList.add('btn-secondary');
        else if (/confirm/.test(button.id)) button.classList.add('btn-primary');
        button.style.removeProperty('padding');
        button.style.removeProperty('border-radius');
        button.style.removeProperty('font-size');
        button.style.removeProperty('font-weight');
        if (button.classList.contains('btn-primary')) {
            button.style.removeProperty('background');
            button.style.removeProperty('color');
        }
    });
    prepareFields(dialog);
    const app = document.getElementById('app');
    const canInertApp = app && !app.contains(overlay);
    const wasInert = app?.inert ?? false;
    if (canInertApp) app.inert = true;
    if (!overlay.isConnected) document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    const keydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && options.canDismiss !== false) {
            event.preventDefault(); event.stopPropagation(); options.cancel();
        } else if (event.key === 'Tab') {
            const controls = Array.from(dialog.querySelectorAll<HTMLElement>(focusSelector))
                .filter(element => element.getClientRects().length && !element.closest('[hidden], [inert]'));
            event.preventDefault(); event.stopPropagation();
            const index = controls.indexOf(document.activeElement as HTMLElement);
            const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
                : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
            (controls[next] ?? dialog).focus();
        }
    };
    const backdrop = (event: MouseEvent) => {
        if (event.target === overlay && options.canDismiss !== false) options.cancel();
    };
    overlay.addEventListener('keydown', keydown);
    overlay.addEventListener('click', backdrop);
    (options.initialFocus ?? dialog.querySelector<HTMLElement>('[autofocus]') ?? dialog).focus({ preventScroll: true });
    let closed = false;
    return (restore = true) => {
        if (closed) return;
        closed = true;
        overlay.removeEventListener('keydown', keydown);
        overlay.removeEventListener('click', backdrop);
        if (options.persistent) overlay.style.display = 'none';
        else overlay.remove();
        document.body.style.overflow = overflow;
        if (canInertApp) app.inert = wasInert;
        if (restore) restoreDialogFocus(restoreTarget);
    };
}

const fixedDialogs = new WeakMap<HTMLElement, () => void>();
export function openFixedDialog(overlay: HTMLElement, initialFocus?: HTMLElement | null, onCancel?: () => void): void {
    fixedDialogs.get(overlay)?.();
    document.body.appendChild(overlay);
    const dialog = overlay.querySelector<HTMLElement>('.modal-content')!;
    fixedDialogs.set(overlay, mountDialogSurface(overlay, dialog, {
        persistent: true, initialFocus, cancel: onCancel ?? (() => closeFixedDialog(overlay))
    }));
}
export function closeFixedDialog(overlay: HTMLElement): void {
    fixedDialogs.get(overlay)?.();
    fixedDialogs.delete(overlay);
    overlay.style.display = 'none';
}
