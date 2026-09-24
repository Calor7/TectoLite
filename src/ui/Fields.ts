import { uiIcon } from './icons';

let nextFieldId = 0;

function hasFieldError(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean {
    const v = control.validity;
    // Step sizes control the spinner increment; fractional simulation values remain valid.
    return v.badInput || v.rangeOverflow || v.rangeUnderflow || v.typeMismatch
        || v.valueMissing || v.tooLong || v.tooShort || v.patternMismatch || v.customError;
}

/** Upgrade application-owned form markup at its render boundary. */
export function prepareFields(root: ParentNode): void {
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea').forEach(control => {
        if (control.type === 'hidden' || control.type === 'file') return;
        control.classList.add('ui-control');
        if (parseFloat(control.style.fontSize) <= 12) control.classList.add('ui-control-compact');
        control.style.removeProperty('font-size');
        control.style.removeProperty('font-family');
        if (!control.dataset.validityReady) {
            control.dataset.validityReady = 'true';
            const validate = (event: Event) => {
                if (!hasFieldError(control)) return;
                event.stopImmediatePropagation();
                if (!control.id) control.id = `ui-field-${++nextFieldId}`;
                const described = control.getAttribute('aria-describedby')?.split(' ').map(id => document.getElementById(id)).find(element => element?.classList.contains('field-error'));
                let error = described ?? document.getElementById(`${control.id}-error`);
                if (!error) {
                    error = document.createElement('span'); error.id = `${control.id}-error`;
                    control.insertAdjacentElement('afterend', error);
                }
                setFieldError(control, error, control.validationMessage);
            };
            control.addEventListener('change', validate, true);
            control.addEventListener('input', () => {
                const error = document.getElementById(`${control.id}-error`);
                if (error && !hasFieldError(control)) setFieldError(control, error, '');
            });
        }
        if (control.labels?.length || control.hasAttribute('aria-label') || control.hasAttribute('aria-labelledby')) return;
        const previous = control.previousElementSibling;
        const group = control.closest('.property-group, .tool-field, .timeline-row');
        const caption = previous?.matches('label, .property-label, .timeline-row-label') ? previous
            : group?.querySelector(':scope > label, :scope > .property-label');
        if (caption && group?.querySelectorAll('input, select, textarea').length !== 1
            && control.title) {
            control.setAttribute('aria-label', control.title);
        } else if (caption) {
            if (!control.id) control.id = `ui-field-${++nextFieldId}`;
            if (caption instanceof HTMLLabelElement) caption.htmlFor = control.id;
            else {
                if (!caption.id) caption.id = `ui-label-${++nextFieldId}`;
                control.setAttribute('aria-labelledby', caption.id);
            }
        } else if (control.title || control.getAttribute('placeholder')) {
            control.setAttribute('aria-label', control.title || control.getAttribute('placeholder')!);
        }
    });
    root.querySelectorAll<HTMLElement>('.info-icon').forEach(info => {
        if (info.dataset.infoReady) return;
        info.dataset.infoReady = 'true';
        info.innerHTML = uiIcon('info');
        info.tabIndex = 0;
        info.setAttribute('role', 'note');
        info.setAttribute('aria-label', info.dataset.tooltip || info.title || 'More information');
    });
}

export function setFieldError(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, message: HTMLElement, error: string): void {
    control.setAttribute('aria-invalid', String(Boolean(error)));
    control.setAttribute('aria-describedby', message.id);
    message.classList.add('field-error');
    message.setAttribute('role', 'alert');
    message.textContent = error;
    message.hidden = !error;
}
