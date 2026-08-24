import { describe, expect, it, vi } from 'vitest';
import {
    canImplicitlyDismiss,
    getModalDialogAttributes,
    getWrappedFocusIndex,
    isSafeImplicitDismissAction,
    type ModalButton
} from './ModalSystem';

const action = (text: string, isSecondary = false): ModalButton => ({
    text,
    isSecondary,
    onClick: vi.fn()
});

describe('ModalSystem accessibility contract', () => {
    it('describes the dialog using its visible title and content', () => {
        expect(getModalDialogAttributes('modal-title-1', 'modal-body-1')).toEqual({
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'modal-title-1',
            'aria-describedby': 'modal-body-1'
        });
    });

    it('wraps forward and backward focus within the modal', () => {
        expect(getWrappedFocusIndex(0, 3, false)).toBe(1);
        expect(getWrappedFocusIndex(2, 3, false)).toBe(0);
        expect(getWrappedFocusIndex(2, 3, true)).toBe(1);
        expect(getWrappedFocusIndex(0, 3, true)).toBe(2);
    });

    it('moves focus into the modal if focus somehow starts outside it', () => {
        expect(getWrappedFocusIndex(-1, 3, false)).toBe(0);
        expect(getWrappedFocusIndex(-1, 3, true)).toBe(2);
        expect(getWrappedFocusIndex(-1, 0, false)).toBe(-1);
    });

    it('enables Escape and backdrop dismissal only when a secondary choice exists', () => {
        expect(canImplicitlyDismiss([action('Delete')])).toBe(false);
        expect(canImplicitlyDismiss([action('Delete'), action('Cancel', true)])).toBe(true);
        expect(canImplicitlyDismiss([action('Restore'), action('Discard', true)])).toBe(true);
    });

    it('never invokes destructive or primary actions as an implicit dismissal', () => {
        expect(isSafeImplicitDismissAction(action('Cancel', true))).toBe(true);
        expect(isSafeImplicitDismissAction(action(' close ', true))).toBe(true);
        expect(isSafeImplicitDismissAction(action('Not now', true))).toBe(true);
        expect(isSafeImplicitDismissAction(action('Discard', true))).toBe(false);
        expect(isSafeImplicitDismissAction(action('Cancel'))).toBe(false);
    });
});
