import { describe, expect, it, vi, afterEach } from 'vitest';
import { runProjectSave, saveProjectFile, type ProjectSaveResult } from './ProjectSave';

afterEach(() => vi.unstubAllGlobals());

describe('project save and recovery', () => {
    it.each<ProjectSaveResult>(['cancelled', 'download-started'])('preserves recovery for %s', async result => {
        const saved = vi.fn();
        const notify = vi.fn();
        await runProjectSave({ save: async () => result, saved, notify });
        expect(saved).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalledWith('Project saved');
        if (result === 'cancelled') expect(notify).not.toHaveBeenCalled();
    });
    it('clears recovery only after a completed write', async () => {
        const events: string[] = [];
        await runProjectSave({ save: async () => { events.push('written'); return 'saved'; },
            saved: () => events.push('clear recovery'), notify: text => events.push(text) });
        expect(events).toEqual(['written', 'clear recovery', 'Project saved']);
    });
    it('reports failure without clearing recovery', async () => {
        const saved = vi.fn();
        const notify = vi.fn();
        await runProjectSave({ save: async () => { throw new Error('Disk full'); }, saved, notify });
        expect(saved).not.toHaveBeenCalled();
        expect(notify).toHaveBeenCalledWith(expect.stringContaining('Disk full'));
    });
    it('waits for the browser writer to close and handles native cancellation', async () => {
        const write = vi.fn().mockResolvedValue(undefined);
        const close = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('window', { showSaveFilePicker: async () => ({ createWritable: async () => ({ write, close }) }) });
        expect(await saveProjectFile('{}', 'project.json')).toBe('saved');
        expect(write).toHaveBeenCalledWith('{}');
        expect(close).toHaveBeenCalledOnce();
        vi.stubGlobal('window', { electron: { saveProject: async () => 'cancelled' } });
        expect(await saveProjectFile('{}', 'project.json')).toBe('cancelled');
    });
    it('treats browser picker cancellation as cancellation without touching a file', async () => {
        vi.stubGlobal('window', { showSaveFilePicker: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
        expect(await saveProjectFile('{}', 'project.json')).toBe('cancelled');
    });
    it('aborts a failed write and keeps recovery without announcing success', async () => {
        const abort = vi.fn().mockResolvedValue(undefined);
        const saved = vi.fn();
        const notify = vi.fn();
        vi.stubGlobal('window', { showSaveFilePicker: async () => ({ createWritable: async () => ({
            write: async () => undefined, close: async () => { throw new Error('Disk full'); }, abort
        }) }) });
        await runProjectSave({ save: () => saveProjectFile('{}', 'project.json'), saved, notify });
        expect(abort).toHaveBeenCalledOnce();
        expect(saved).not.toHaveBeenCalled();
        expect(notify).toHaveBeenCalledWith(expect.stringContaining('Disk full'));
    });
});
