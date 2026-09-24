import { mountDialogSurface } from './DialogSurface';
import { prepareFields } from './Fields';
import { showModal } from './ModalSystem';
import { uiIcon } from './icons';

/** Relocate the existing controls, preserving their IDs, values and event bindings. */
export function prepareWorkspaceSurfaces(): void {
    const settings = document.getElementById('planet-dropdown-menu');
    const view = document.getElementById('view-dropdown-menu');
    const trigger = document.getElementById('btn-planet');
    if (settings && view && trigger) {
        const overlay = document.createElement('div');
        overlay.hidden = true;
        overlay.className = 'settings-overlay';
        const dialog = document.createElement('div');
        dialog.className = 'settings-dialog';
        dialog.setAttribute('aria-labelledby', 'settings-title');
        dialog.innerHTML = '<h3 id="settings-title">Settings</h3><p class="settings-intro">Application behavior, drawing defaults and map appearance.</p>';
        settings.className = 'settings-sections';
        settings.removeAttribute('style');
        for (const id of ['overlay-select', 'plate-opacity-slider', 'grid-thickness-select']) {
            const control = document.getElementById(id);
            const section = id === 'overlay-select' ? control?.closest('.dropdown-section')
                : id === 'plate-opacity-slider' ? control?.parentElement?.parentElement : control?.parentElement;
            if (section) {
                if (id !== 'overlay-select') {
                    if (id === 'plate-opacity-slider') section.querySelector('label')?.remove();
                    const label = document.createElement('label');
                    label.htmlFor = id;
                    label.textContent = id === 'grid-thickness-select' ? 'Grid thickness' : 'Plate opacity';
                    section.prepend(label);
                    section.classList.add('settings-field');
                }
                settings.appendChild(section);
            }
        }
        view.querySelectorAll('.dropdown-section').forEach(section => {
            if (section.querySelector('.ui-default-colors-row')) settings.appendChild(section);
        });
        for (const section of Array.from(settings.querySelectorAll<HTMLElement>(':scope > .dropdown-section'))) {
            const heading = section.querySelector<HTMLElement>('.dropdown-header');
            if (!heading) continue;
            const details = document.createElement('details'); details.className = 'settings-section';
            const summary = document.createElement('summary'); summary.textContent = heading.textContent?.trim() ?? 'Settings';
            details.open = summary.textContent === 'Timeline & simulation' || summary.textContent === 'Planet model';
            section.before(details); details.append(summary, section);
        }
        dialog.appendChild(settings);
        const actions = document.createElement('div');
        actions.className = 'app-modal-actions';
        const close = document.createElement('button');
        close.type = 'button'; close.className = 'btn btn-secondary'; close.textContent = 'Close';
        actions.appendChild(close); dialog.appendChild(actions); overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        let cleanup: (() => void) | undefined;
        const dismiss = () => { cleanup?.(); overlay.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
        close.addEventListener('click', dismiss);
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.addEventListener('click', () => {
            overlay.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
            cleanup = mountDialogSurface(overlay, dialog, { persistent: true, width: '640px', cancel: dismiss, initialFocus: close });
        });
        prepareFields(dialog);
    }

    const toolbar = document.getElementById('toolbar');
    if (toolbar) {
        const chooser = document.createElement('button');
        chooser.type = 'button'; chooser.className = 'btn btn-secondary tool-menu-trigger';
        chooser.setAttribute('aria-label', 'Choose a tool');
        chooser.innerHTML = `${uiIcon('chevron-down')}<span>Tools</span>`;
        chooser.addEventListener('click', () => showModal({
            title: 'Choose a tool', content: 'Select a tool to use on the map.',
            buttons: [...Array.from(toolbar.querySelectorAll<HTMLButtonElement>('.tool-btn')).map(button => ({
                text: button.textContent?.trim() || button.title,
                onClick: () => { button.click(); button.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
            })), { text: 'Cancel', isSecondary: true, onClick: () => undefined }]
        }));
        toolbar.prepend(chooser);
    }
}

/** Native buttons keep selection usable with Enter/Space; arrows move within the list. */
export function prepareExplorerKeyboard(list: HTMLElement, restoreId?: string): void {
    const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('.plate-select'));
    buttons.forEach((button, index) => {
        button.addEventListener('keydown', event => {
            if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
            buttons[next]?.focus();
        });
        if (restoreId && button.dataset.entityId === restoreId) button.focus({ preventScroll: true });
    });
    prepareFields(list);
}
