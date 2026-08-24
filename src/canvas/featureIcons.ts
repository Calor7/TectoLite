import type { FeatureType } from '../types';

/** Point features offered by the Feature tool. Polygon regions use their own drawing workflow. */
export const FEATURE_TOOL_TYPES = [
    'mountain',
    'volcano',
    'island',
    'rift',
    'trench',
    'weakness',
    'seafloor',
    'hotspot',
] as const satisfies readonly FeatureType[];

export type FeatureToolType = typeof FEATURE_TOOL_TYPES[number];

export interface FeatureIconOptions {
    isSelected?: boolean;
}

export type FeatureIconDrawer = (
    ctx: CanvasRenderingContext2D,
    size: number,
    options?: FeatureIconOptions
) => void;

interface FeatureIconDefinition {
    label: string;
    description: string;
    color: string;
    svg: string;
    draw: (ctx: CanvasRenderingContext2D, size: number) => void;
}

const strokeWidth = (size: number): number => Math.max(1.5, size * 0.15);

function mountain(ctx: CanvasRenderingContext2D, size: number): void {
    ctx.beginPath();
    ctx.moveTo(-size, size * 0.75);
    ctx.lineTo(0, -size);
    ctx.lineTo(size, size * 0.75);
    ctx.closePath();
    ctx.fillStyle = '#a66a3f';
    ctx.fill();
    ctx.strokeStyle = '#5f3924';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-size * 0.32, -size * 0.32);
    ctx.lineTo(0, -size);
    ctx.lineTo(size * 0.32, -size * 0.32);
    ctx.closePath();
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
}

function volcano(ctx: CanvasRenderingContext2D, size: number): void {
    ctx.beginPath();
    ctx.moveTo(-size, size * 0.75);
    ctx.lineTo(-size * 0.32, -size * 0.45);
    ctx.lineTo(size * 0.32, -size * 0.45);
    ctx.lineTo(size, size * 0.75);
    ctx.closePath();
    ctx.fillStyle = '#8a5037';
    ctx.fill();
    ctx.strokeStyle = '#503022';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-size * 0.25, -size * 0.45);
    ctx.quadraticCurveTo(0, -size * 0.85, size * 0.25, -size * 0.45);
    ctx.strokeStyle = '#fb5a3c';
    ctx.stroke();
}

function island(ctx: CanvasRenderingContext2D, size: number): void {
    ctx.beginPath();
    ctx.ellipse(0, size * 0.08, size, size * 0.58, -0.12, 0, Math.PI * 2);
    ctx.fillStyle = '#55a06f';
    ctx.fill();
    ctx.strokeStyle = '#285b42';
    ctx.stroke();
}

function rift(ctx: CanvasRenderingContext2D, size: number): void {
    ctx.beginPath();
    ctx.moveTo(-size, -size * 0.55);
    ctx.lineTo(-size * 0.38, -size * 0.12);
    ctx.lineTo(-size * 0.72, size * 0.58);
    ctx.moveTo(size, -size * 0.55);
    ctx.lineTo(size * 0.38, -size * 0.12);
    ctx.lineTo(size * 0.72, size * 0.58);
    ctx.strokeStyle = '#e96b6b';
    ctx.stroke();
}

function trench(ctx: CanvasRenderingContext2D, size: number): void {
    ctx.beginPath();
    ctx.moveTo(-size, -size * 0.35);
    ctx.quadraticCurveTo(0, size * 0.85, size, -size * 0.35);
    ctx.strokeStyle = '#60a5fa';
    ctx.stroke();
}

function weakness(ctx: CanvasRenderingContext2D, size: number): void {
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.72, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size * 0.72, 0);
    ctx.closePath();
    ctx.setLineDash([size * 0.3, size * 0.18]);
    ctx.strokeStyle = '#c084fc';
    ctx.stroke();
    ctx.setLineDash([]);
}

function seafloor(ctx: CanvasRenderingContext2D, size: number): void {
    ctx.beginPath();
    ctx.moveTo(-size, size * 0.38);
    ctx.lineTo(-size * 0.5, -size * 0.12);
    ctx.lineTo(0, size * 0.38);
    ctx.lineTo(size * 0.5, -size * 0.12);
    ctx.lineTo(size, size * 0.38);
    ctx.strokeStyle = '#38bdf8';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -size * 0.42, size * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
}

function hotspot(ctx: CanvasRenderingContext2D, size: number): void {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(249, 115, 22, 0.25)';
    ctx.fill();
    ctx.strokeStyle = '#f97316';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = '#fb5a3c';
    ctx.fill();
}

export const FEATURE_ICON_CATALOG: Record<FeatureToolType, FeatureIconDefinition> = {
    mountain: {
        label: 'Mountain', description: 'Mountain attached to the selected plate', color: '#a66a3f',
        svg: '<path d="m3 20 7-14 3 6 2-4 6 12Z"/><path d="m8 10 2-4 2 4"/>', draw: mountain,
    },
    volcano: {
        label: 'Volcano', description: 'Volcano attached to the selected plate', color: '#e06443',
        svg: '<path d="m3 20 7-13 2 5 2-5 7 13Z"/><path d="M10 6c0-2 2-2 2-4M14 6c0-2 2-2 2-4"/>', draw: volcano,
    },
    island: {
        label: 'Island', description: 'Island attached to the selected plate', color: '#55a06f',
        svg: '<path d="M4 14c2-4 5-6 8-4 3-2 6 0 8 4-2 3-5 4-8 3-3 1-6 0-8-3Z"/><path d="M3 20h18"/>', draw: island,
    },
    rift: {
        label: 'Rift', description: 'Rift marker attached to the selected plate', color: '#e96b6b',
        svg: '<path d="m5 4 5 5-3 4 3 7M19 4l-5 5 3 4-3 7"/>', draw: rift,
    },
    trench: {
        label: 'Trench', description: 'Trench marker attached to the selected plate', color: '#60a5fa',
        svg: '<path d="M3 8c3 9 15 9 18 0"/><path d="M6 8v3M10 11v3M14 11v3M18 8v3"/>', draw: trench,
    },
    weakness: {
        label: 'Weakness', description: 'Weak-zone marker attached to the selected plate', color: '#c084fc',
        svg: '<path stroke-dasharray="2.5 2" d="m12 3 7 9-7 9-7-9Z"/>', draw: weakness,
    },
    seafloor: {
        label: 'Seafloor', description: 'Seafloor marker attached to the selected plate', color: '#38bdf8',
        svg: '<path d="m3 15 4-4 5 4 5-4 4 4"/><circle cx="12" cy="7" r="1.5"/>', draw: seafloor,
    },
    hotspot: {
        label: 'Hotspot', description: 'Fixed mantle marker; it does not move with a plate', color: '#f97316',
        svg: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', draw: hotspot,
    },
};

/** One rendering boundary for the live canvas and image exports. */
export function drawFeatureIcon(
    ctx: CanvasRenderingContext2D,
    type: FeatureToolType,
    size: number,
    options: FeatureIconOptions = {}
): void {
    ctx.save();
    ctx.lineWidth = strokeWidth(size);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    FEATURE_ICON_CATALOG[type].draw(ctx, size);

    if (options.isSelected) {
        ctx.beginPath();
        ctx.arc(0, 0, size * 1.22, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, size * 0.18);
        ctx.setLineDash([]);
        ctx.stroke();
    }
    ctx.restore();
}

/** Normalized 24 px feature glyph for toolbars and lists. */
export function featureToolIcon(type: FeatureToolType): string {
    const definition = FEATURE_ICON_CATALOG[type];
    return `<svg class="feature-icon" data-feature-icon="${type}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:${definition.color}">${definition.svg}</svg>`;
}

/** Backwards-compatible registry shared by the live canvas and PNG export. */
export const FEATURE_ICON_DRAWERS: Partial<Record<FeatureType, FeatureIconDrawer>> = Object.fromEntries(
    FEATURE_TOOL_TYPES.map(type => [
        type,
        (ctx: CanvasRenderingContext2D, size: number, options?: FeatureIconOptions) => drawFeatureIcon(ctx, type, size, options),
    ])
) as Partial<Record<FeatureType, FeatureIconDrawer>>;
