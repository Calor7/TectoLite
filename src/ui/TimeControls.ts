import { setFieldError } from './Fields';
import { closeFixedDialog } from './DialogSurface';
/**
 * TimeControls - Time display, parsing, play button, toast notifications,
 * and time transformation utilities.
 * Extracted from main.ts TectoLiteApp class.
 */
import { uiIcon } from './icons';

/**
 * Updates the play button text based on playing state.
 */
export function updatePlayButton(isPlaying: boolean): void {
    const btn = document.getElementById('btn-play');
    if (btn && btn.getAttribute('aria-label') !== (isPlaying ? 'Pause timeline' : 'Play timeline')) {
        btn.innerHTML = uiIcon(isPlaying ? 'pause' : 'play');
        btn.setAttribute('aria-label', isPlaying ? 'Pause timeline' : 'Play timeline');
    }
}

/**
 * Shows a brief toast above the timeline, away from the centered map hint.
 */
export function showToast(message: string, duration: number = 2000): void {
    // Remove existing toast if any
    const existing = document.getElementById('toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'toast-notification';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = `
        position: fixed;
        bottom: calc(var(--timeline-height) + 16px);
        right: 16px;
        background: color-mix(in srgb, var(--bg-surface) 95%, transparent);
        color: var(--text-primary);
        padding: 10px 16px;
        border-radius: var(--radius-sm);
        font-size: 14px;
        z-index: 10000;
        pointer-events: none;
        animation: toastFadeIn 0.2s ease-out;
        border: 1px solid var(--border-default);
        box-shadow: var(--shadow-md);
    `;
    toast.textContent = message;

    // Add animation keyframes if not present
    if (!document.getElementById('toast-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
            @keyframes toastFadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes toastFadeOut {
                from { opacity: 1; transform: translateY(0); }
                to { opacity: 0; transform: translateY(10px); }
            }
            @media (prefers-reduced-motion: reduce) {
                @keyframes toastFadeIn { from { opacity: 1; } to { opacity: 1; } }
                @keyframes toastFadeOut { from { opacity: 1; } to { opacity: 1; } }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastFadeOut 0.2s ease-in forwards';
        setTimeout(() => toast.remove(), 200);
    }, duration);
}

/**
 * Updates the time display element and slider to reflect current time.
 */
export function updateTimeDisplay(currentTime: number): void {
    const display = document.getElementById('current-time');
    const slider = document.getElementById('time-slider') as HTMLInputElement;

    if (display) display.textContent = currentTime.toFixed(1);
    if (slider) slider.value = String(currentTime);
}

/**
 * Parses a time input string into a number.
 * Returns null if the input is empty or invalid.
 */
export function parseTimeInput(input: string): number | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Gets the display time value (currently identity, but kept for future time mode support).
 */
export function getDisplayTimeValue(internalTime: number | null | undefined): number | null {
    if (internalTime === null || internalTime === undefined) return null;
    return internalTime;
}

/**
 * Transforms user input time to internal time (currently identity, but kept for future time mode support).
 */
export function transformInputTime(userInputTime: number): number {
    return userInputTime;
}

/**
 * Handles the confirm action for the time input modal.
 */
export function confirmTimeInput(
    callbacks: {
        setTime: (time: number) => void;
        updateTimeDisplay: () => void;
    }
): void {
    const input = document.getElementById('time-input-field') as HTMLInputElement;
    const modal = document.getElementById('time-input-modal');

    if (!input || !modal) return;

    const displayTimeStr = input.value.trim();
    const parsedDisplayTime = parseTimeInput(displayTimeStr);

    if (parsedDisplayTime === null) {
        const error = document.getElementById('time-input-error');
        if (error) setFieldError(input, error, 'Enter a finite time of 0 Ma or later.');
        input.focus();
        return;
    }

    const error = document.getElementById('time-input-error');
    if (error) setFieldError(input, error, '');
    // Internal time is used directly
    const internalTime = parsedDisplayTime;

    // Set the time
    callbacks.setTime(internalTime);
    callbacks.updateTimeDisplay();

    // Close modal
    closeFixedDialog(modal);
}
