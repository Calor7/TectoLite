export type LabelAttachmentDefault = 'auto' | 'fixed' | 'selected';

export interface ToolPreferences {
    navigation: {
        sensitivity: number;
        reverseDrag: boolean;
        keepMapReachable: boolean;
    };
    label: {
        attachment: LabelAttachmentDefault;
        color: string;
        expanded: boolean;
    };
    split: {
        inheritMomentum: boolean;
        onlySelected: boolean;
    };
}

export const DEFAULT_TOOL_PREFERENCES: ToolPreferences = {
    navigation: {
        sensitivity: 1,
        reverseDrag: false,
        keepMapReachable: true
    },
    label: {
        attachment: 'auto',
        color: '#fbbf24',
        expanded: false
    },
    split: {
        inheritMomentum: true,
        onlySelected: false
    }
};

const STORAGE_KEY = 'tectolite-tool-preferences-v1';
const VALID_SENSITIVITIES = [0.6, 1, 1.5];

function isHexColor(value: unknown): value is string {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function normalizeToolPreferences(value: unknown): ToolPreferences {
    const candidate = value && typeof value === 'object' ? value as Partial<ToolPreferences> : {};
    const navigation: Partial<ToolPreferences['navigation']> = candidate.navigation && typeof candidate.navigation === 'object'
        ? candidate.navigation
        : {};
    const label: Partial<ToolPreferences['label']> = candidate.label && typeof candidate.label === 'object'
        ? candidate.label
        : {};
    const split: Partial<ToolPreferences['split']> = candidate.split && typeof candidate.split === 'object'
        ? candidate.split
        : {};
    const attachment = label.attachment;
    const sensitivity = Number(navigation.sensitivity);

    return {
        navigation: {
            sensitivity: VALID_SENSITIVITIES.includes(sensitivity) ? sensitivity : DEFAULT_TOOL_PREFERENCES.navigation.sensitivity,
            reverseDrag: typeof navigation.reverseDrag === 'boolean' ? navigation.reverseDrag : DEFAULT_TOOL_PREFERENCES.navigation.reverseDrag,
            keepMapReachable: typeof navigation.keepMapReachable === 'boolean'
                ? navigation.keepMapReachable
                : DEFAULT_TOOL_PREFERENCES.navigation.keepMapReachable
        },
        label: {
            attachment: attachment === 'fixed' || attachment === 'selected' ? attachment : 'auto',
            color: isHexColor(label.color) ? label.color : DEFAULT_TOOL_PREFERENCES.label.color,
            expanded: typeof label.expanded === 'boolean' ? label.expanded : DEFAULT_TOOL_PREFERENCES.label.expanded
        },
        split: {
            inheritMomentum: typeof split.inheritMomentum === 'boolean'
                ? split.inheritMomentum
                : DEFAULT_TOOL_PREFERENCES.split.inheritMomentum,
            onlySelected: typeof split.onlySelected === 'boolean'
                ? split.onlySelected
                : DEFAULT_TOOL_PREFERENCES.split.onlySelected
        }
    };
}

export function loadToolPreferences(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): ToolPreferences {
    if (!storage) return normalizeToolPreferences(undefined);
    try {
        const saved = storage.getItem(STORAGE_KEY);
        return normalizeToolPreferences(saved ? JSON.parse(saved) : undefined);
    } catch {
        return normalizeToolPreferences(undefined);
    }
}

export function saveToolPreferences(
    preferences: ToolPreferences,
    storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage
): void {
    if (!storage) return;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(normalizeToolPreferences(preferences)));
    } catch {
        // Keep the in-memory preference when storage is unavailable.
    }
}
