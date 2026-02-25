export interface TutorialEntry {
    text: string;
    // Optional secondary tooltips triggered by clicking words wrapped in <span class="help-link" data-target="key">...</span>
    nested?: Record<string, string>;
}

export type TutorialDictionaryData = Record<string, TutorialEntry>;

/**
 * Maps element IDs or data-help attributes to tutorial documentation.
 * Uses HTML IDs prefixed with '#' or class names with '.'.
 */
export const TutorialDictionary: TutorialDictionaryData = {
    // Top Bar Actions
    '#btn-tutorial-help': {
        text: 'Click this button again, or press <kbd>Escape</kbd>, to close the tutorial overlay.'
    },
    '#btn-planet': {
        text: 'Opens the <strong style="color:var(--accent-primary);">Settings Menu</strong> to configure simulation rules, timeline length, and global parameters.',
        nested: {
            'planet-radius': 'Radius is locked if "Custom Planet Radius" is unchecked.',
            'timeline': 'Maximum duration of the geological history in Ma (Mega-annum).'
        }
    },
    '#btn-view-panels': {
        text: 'Configure which UI panels and visual effects are toggled on or off.'
    },
    '#btn-reset-camera': {
        text: 'Resets the 3D globe camera to default zoom and orientation.'
    },
    '#btn-theme-toggle': {
        text: 'Toggle between <strong style="color:var(--accent-primary);">Light</strong> and <strong style="color:var(--accent-primary);">Dark</strong> UI themes.'
    },
    '#btn-undo': {
        text: 'Undo the last action (Shortcut: <kbd>Ctrl+Z</kbd>).'
    },
    '#btn-redo': {
        text: 'Redo previously undone action (Shortcut: <kbd>Ctrl+Y</kbd>).'
    },

    // Tools
    '[data-tool="select"]': {
        text: 'The <strong style="color:var(--accent-primary);">Select Tool</strong> lets you pick plates to view their properties, select boundaries, or prepare for splitting/fusion.',
    },
    '[data-tool="pan"]': {
        text: 'The <strong style="color:var(--accent-primary);">Rotate Tool</strong> is used to assign <span class="help-link" data-target="euler-pole">Euler Poles</span> for plate movement across the surface.',
        nested: {
            'euler-pole': 'The axis of rotation for a tectonic plate on the sphere.'
        }
    },
    '[data-tool="draw"]': {
        text: 'The <strong style="color:var(--accent-primary);">Draw Tool</strong> allows you to sketch new continental structures and oceanic rifts.',
    },
    '[data-tool="edit"]': {
        text: 'The <strong style="color:var(--accent-primary);">Edit Tool</strong> alters existing plate geometries by modifying their vertices.'
    },
    '[data-tool="split"]': {
        text: 'The <strong style="color:var(--accent-primary);">Split Tool</strong> dissects a plate into two pieces by drawing a boundary through it.'
    },
    '[data-tool="link"]': {
        text: 'The <strong style="color:var(--accent-primary);">Link Tool</strong> creates a parent/child hierarchical <span class="help-link" data-target="kinematics">kinematic relationship</span> between two plates.',
        nested: {
            'kinematics': 'Child plates will inherit the rotation (Euler pole) of their parent.'
        }
    },
    '[data-tool="fuse"]': {
        text: 'The <strong style="color:var(--accent-primary);">Fuse Tool</strong> merges two adjacent plates into a single continuous polygon.'
    },

    // Timeline
    '#btn-play': {
        text: 'Start or Pause the <strong style="color:var(--accent-primary);">Simulation Timeline</strong>.'
    },
    '#speed-select': {
        text: 'Adjust the playback speed multiplier of the simulation.'
    },
    '#time-slider': {
        text: 'Scrub through geohistory. Left side is current time, right side is genesis / birth time.'
    },
    '#time-mode-label': {
        text: 'Current time in <span class="help-link" data-target="mega-annum">Ma</span>. Represents millions of years ago.',
        nested: {
            'mega-annum': 'Ma stands for Mega-annum, equivalent to one million years.'
        }
    },

    // Panels
    '#properties-panel': {
        text: '<strong style="color:var(--accent-primary);">Properties Panel:</strong> Edit selected plate color, name, and oceanic crust settings.'
    },
    '#timeline-panel': {
        text: '<strong style="color:var(--accent-primary);">Timeline Box:</strong> View recent significant geological events like continent splits and collisions.'
    },
    '#plate-sidebar': {
        text: 'The <strong style="color:var(--accent-primary);">Explorer</strong> lists all tectonic plates currently active in the simulation. Select them from here.'
    }
};
