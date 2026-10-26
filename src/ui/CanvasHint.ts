import { uiIcon } from './icons';

export const HINT_MINIMIZED_STORAGE_KEY = 'tectolite-hint-minimized';

export function loadHintMinimized(storage: Pick<Storage, 'getItem'> | null): boolean {
    try {
        return storage?.getItem(HINT_MINIMIZED_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function saveHintMinimized(minimized: boolean, storage: Pick<Storage, 'setItem'> | null): void {
    try {
        storage?.setItem(HINT_MINIMIZED_STORAGE_KEY, String(minimized));
    } catch {
        // Keep the in-memory choice when storage is unavailable.
    }
}

export interface HintView {
    visible: boolean;
    minimized: boolean;
    buttonLabel: string;
    /** Tooltip on the button. When minimized it previews the hint text. */
    buttonTitle: string;
}

export function hintView(text: string | null, enabled: boolean, minimized: boolean): HintView {
    const visible = enabled && !!text;
    return {
        visible,
        minimized,
        buttonLabel: minimized ? 'Show hint' : 'Minimize hint',
        buttonTitle: minimized && text ? text : 'Minimize hint',
    };
}

/**
 * The tool hint at the bottom of the map. One click shrinks it to a small
 * "Hint" button so it stops covering the shapes being edited, and another
 * click brings it back. The choice is remembered per user, not per project.
 */
export class CanvasHint {
    private readonly text: HTMLElement;
    private readonly button: HTMLButtonElement;
    private minimized: boolean;
    private currentText: string | null = null;
    private enabled = true;

    constructor(
        private readonly root: HTMLElement,
        private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null,
    ) {
        this.minimized = loadHintMinimized(storage);
        root.innerHTML = '<span class="canvas-hint-text"></span><button type="button" class="canvas-hint-toggle"></button>';
        this.text = root.querySelector<HTMLElement>('.canvas-hint-text')!;
        this.button = root.querySelector<HTMLButtonElement>('.canvas-hint-toggle')!;
        this.button.addEventListener('click', () => this.setMinimized(!this.minimized));
        this.render();
    }

    show(text: string | null, enabled: boolean): void {
        this.currentText = text;
        this.enabled = enabled;
        this.render();
    }

    setMinimized(minimized: boolean): void {
        this.minimized = minimized;
        saveHintMinimized(minimized, this.storage);
        this.render();
    }

    private render(): void {
        const view = hintView(this.currentText, this.enabled, this.minimized);
        this.root.hidden = !view.visible;
        this.root.classList.toggle('minimized', view.minimized);
        this.text.textContent = this.currentText ?? '';
        this.button.setAttribute('aria-expanded', String(!view.minimized));
        this.button.setAttribute('aria-label', view.buttonLabel);
        this.button.title = view.buttonTitle;
        this.button.innerHTML = view.minimized
            ? `${uiIcon('help-circle')}<span>Hint</span>`
            : uiIcon('chevron-down');
    }
}
