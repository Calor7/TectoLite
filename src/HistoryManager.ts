// History Manager for Undo/Redo functionality
import { AppState } from './types';

export class HistoryManager {
    private history: AppState[] = [];
    private future: AppState[] = [];
    private maxHistory = 50;
    private isProcessing = false;

    /**
     * Push a new state to history (called after meaningful actions)
     */
    push(state: AppState): void {
        if (this.isProcessing) return;

        // Deep clone the state to prevent mutations
        const snapshot = this.cloneState(state);
        this.history.push(snapshot);

        // Clear future when new action is taken
        this.future = [];

        // Limit history size
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }
    }

    /**
     * Undo: Pop from history, push current to future
     * Returns the previous state or null if nothing to undo
     */
    undo(currentState: AppState): AppState | null {
        if (this.history.length === 0) return null;

        this.isProcessing = true;

        // Save current state to future for redo
        this.future.push(this.cloneState(currentState));

        // Pop previous state from history
        const previousState = this.history.pop()!;

        this.isProcessing = false;

        return previousState;
    }

    /**
     * Redo: Pop from future, push current to history
     * Returns the next state or null if nothing to redo
     */
    redo(currentState: AppState): AppState | null {
        if (this.future.length === 0) return null;

        this.isProcessing = true;

        // Save current state to history
        this.history.push(this.cloneState(currentState));

        // Pop next state from future
        const nextState = this.future.pop()!;

        this.isProcessing = false;

        return nextState;
    }

    /**
     * Check if undo is available
     */
    canUndo(): boolean {
        return this.history.length > 0;
    }

    /**
     * Check if redo is available
     */
    canRedo(): boolean {
        return this.future.length > 0;
    }

    /**
     * Clear all history
     */
    clear(): void {
        this.history = [];
        this.future = [];
    }

    /**
     * Deep clone state to prevent mutation issues
     */
    private cloneState(state: AppState): AppState {
        return JSON.parse(JSON.stringify(state));
    }
}
