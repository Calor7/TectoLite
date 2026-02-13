/**
 * TimeControls - Time display, parsing, play button, toast notifications,
 * and time transformation utilities.
 * Extracted from main.ts TectoLiteApp class.
 */

/**
 * Updates the play button text based on playing state.
 */
export function updatePlayButton(isPlaying: boolean): void {
    const btn = document.getElementById('btn-play');
    if (btn) btn.textContent = isPlaying ? '⏸️' : '▶️';
}

/**
 * Shows a brief toast notification at the bottom of the screen.
 */
export function showToast(message: string, duration: number = 2000): void {
    // Remove existing toast if any
    const existing = document.getElementById('toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'toast-notification';
    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(30, 30, 46, 0.95);
        color: #cdd6f4;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 10000;
        pointer-events: none;
        animation: toastFadeIn 0.2s ease-out;
        border: 1px solid rgba(137, 180, 250, 0.3);
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    toast.textContent = message;

    // Add animation keyframes if not present
    if (!document.getElementById('toast-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
            @keyframes toastFadeIn {
                from { opacity: 0; transform: translateX(-50%) translateY(10px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
            @keyframes toastFadeOut {
                from { opacity: 1; transform: translateX(-50%) translateY(0); }
                to { opacity: 0; transform: translateX(-50%) translateY(10px); }
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
    const parsed = parseFloat(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
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
        alert('Please enter a valid time value');
        return;
    }

    // Internal time is used directly
    const internalTime = parsedDisplayTime;

    // Set the time
    callbacks.setTime(internalTime);
    callbacks.updateTimeDisplay();

    // Close modal
    modal.style.display = 'none';
}
