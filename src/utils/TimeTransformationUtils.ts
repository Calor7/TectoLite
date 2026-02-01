/**
 * TimeTransformationUtils
 * 
 * Handles bidirectional time transformation between internal (always positive) 
 * and display (positive or negative mode) time values.
 * 
 * Internal Logic: ALWAYS uses positive time (0 to maxTime)
 * UI Display: Can show as positive (0 to maxTime) or negative (-maxTime to 0)
 */

type TimeMode = 'positive' | 'negative';

interface TimeTransformationContext {
    maxTime: number;
    mode: TimeMode;
}

/**
 * Convert an internal positive time value to display value based on current mode
 * @param internalTime - Internal positive time value
 * @param context - Transformation context
 * @returns Display time (positive or negative depending on mode)
 */
export function toDisplayTime(internalTime: number, context: TimeTransformationContext): number {
    const { maxTime, mode } = context;
    
    if (mode === 'positive') {
        return internalTime;
    } else {
        // negative mode: 0 becomes -maxTime, maxTime becomes 0
        return internalTime - maxTime;
    }
}

/**
 * Convert a display time value (positive or negative) to internal positive time
 * @param displayTime - Display time value (can be positive or negative)
 * @param context - Transformation context
 * @returns Internal positive time value (0 to maxTime)
 */
export function toInternalTime(displayTime: number, context: TimeTransformationContext): number {
    const { maxTime, mode } = context;
    
    if (mode === 'positive') {
        return Math.max(0, Math.min(displayTime, maxTime));
    } else {
        // negative mode: -maxTime becomes 0, 0 becomes maxTime
        const internal = displayTime + maxTime;
        return Math.max(0, Math.min(internal, maxTime));
    }
}

/**
 * Parse user input string to a numeric time value
 * Handles input like "50", "-50", "50.5", "-50.5"
 * @param input - User input string
 * @returns Parsed number or null if invalid
 */
export function parseTimeInput(input: string): number | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    
    const parsed = parseFloat(trimmed);
    return isNaN(parsed) ? null : parsed;
}

