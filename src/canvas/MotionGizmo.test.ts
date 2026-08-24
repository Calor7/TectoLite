import { describe, expect, it } from 'vitest';
import { MotionGizmo, resolveMotionLabelStyle } from './MotionGizmo';
import type { ProjectionManager } from './ProjectionManager';

describe('MotionGizmo velocity labels', () => {
    it('colors the approach to the realistic maximum, then uses a warning outline above it', () => {
        const options = {
            normalColor: '#ffffff',
            useSpeedGradient: true,
            highSpeedColor: '#ff0000',
            normalSpeedMaxCmYr: 6,
            highSpeedCmYr: 8,
            outlineStartSpeedCmYr: 15,
            outlineFullSpeedCmYr: 20,
        };

        expect(resolveMotionLabelStyle(5, options)).toEqual({
            fillColor: '#ffffff', warningOutlineColor: null,
        });
        expect(resolveMotionLabelStyle(7, options)).toEqual({
            fillColor: '#ff8080', warningOutlineColor: null,
        });
        expect(resolveMotionLabelStyle(8, options)).toEqual({
            fillColor: '#ff0000', warningOutlineColor: null,
        });
        expect(resolveMotionLabelStyle(15, options)).toEqual({
            fillColor: '#ff0000', warningOutlineColor: null,
        });
        expect(resolveMotionLabelStyle(16, options)).toEqual({
            fillColor: '#ff0000', warningOutlineColor: 'rgba(255, 0, 0, 0.2)',
        });
        expect(resolveMotionLabelStyle(20, options)).toEqual({
            fillColor: '#ff0000', warningOutlineColor: 'rgba(255, 0, 0, 1)',
        });
        expect(resolveMotionLabelStyle(16, { ...options, useSpeedGradient: false })).toEqual({
            fillColor: '#ffffff', warningOutlineColor: null,
        });
    });

    it('draws both speed labels in white with a dark outline over map colors', () => {
        const textCalls: Array<{ kind: 'fill' | 'stroke'; text: string; color: string }> = [];
        const context = {
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 1,
            lineCap: 'butt',
            textAlign: 'start',
            textBaseline: 'alphabetic',
            font: '',
            save: () => undefined,
            restore: () => undefined,
            beginPath: () => undefined,
            arc: () => undefined,
            fill: () => undefined,
            stroke: () => undefined,
            moveTo: () => undefined,
            lineTo: () => undefined,
            fillText(text: string) {
                const style = (this as unknown as { fillStyle: string }).fillStyle;
                textCalls.push({ kind: 'fill', text, color: style });
            },
            strokeText(text: string) {
                const style = (this as unknown as { strokeStyle: string }).strokeStyle;
                textCalls.push({ kind: 'stroke', text, color: style });
            },
        } as unknown as CanvasRenderingContext2D;
        const projection = {
            project: ([longitude, latitude]: [number, number]) => [400 + longitude, 240 - latitude],
        } as unknown as ProjectionManager;
        const gizmo = new MotionGizmo();
        gizmo.setMode('drag_target');
        gizmo.setPlate('plate', { position: [90, 0], rate: 1.9 });
        expect(gizmo.isActive()).toBe(true);
        expect(gizmo.getPlateId()).toBe('plate');
        expect(gizmo.isDragging()).toBe(false);

        gizmo.render(context, projection, [0, 0], 6371);

        expect(textCalls.find(call => call.kind === 'fill' && call.text.includes('cm/yr'))?.color).toBe('#ffffff');

        for (const unit of ['°/Ma', 'cm/yr']) {
            const fill = textCalls.find(call => call.kind === 'fill' && call.text.includes(unit));
            const outline = textCalls.find(call => call.kind === 'stroke' && call.text.includes(unit));
            expect(fill?.color).toBe('#ffffff');
            expect(outline?.color).toBe('rgba(0, 0, 0, 0.9)');
        }

        textCalls.length = 0;
        gizmo.setLabelOptions({
            normalColor: '#fefefe',
            useSpeedGradient: true,
            highSpeedColor: '#ff0000',
            normalSpeedMaxCmYr: 18,
            highSpeedCmYr: 20,
            outlineStartSpeedCmYr: 20,
            outlineFullSpeedCmYr: 25,
        });
        gizmo.render(context, projection, [0, 0], 6371);
        expect(textCalls.find(call => call.kind === 'fill' && call.text.includes('cm/yr'))?.color).toBe('#ff0000');
        expect(textCalls.some(call => call.kind === 'stroke'
            && call.text.includes('cm/yr')
            && call.color.startsWith('rgba(255, 0, 0,'))).toBe(true);

        gizmo.clear();
        expect(gizmo.isActive()).toBe(false);
        expect(gizmo.getPlateId()).toBeNull();
    });
});
