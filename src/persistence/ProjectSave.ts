export type ProjectSaveResult = 'saved' | 'cancelled' | 'download-started';

/** Keep recovery until the file API has acknowledged a completed write. */
export async function saveProjectFile(json: string, filename: string): Promise<ProjectSaveResult> {
    const host = window as unknown as {
        electron?: { saveProject?: (json: string, filename: string) => Promise<'saved' | 'cancelled'> };
        showSaveFilePicker?: (options: unknown) => Promise<{
            createWritable(): Promise<{ write(value: string): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
        }>;
    };
    if (host.electron?.saveProject) return host.electron.saveProject(json, filename);
    if (host.showSaveFilePicker) {
        try {
            const handle = await host.showSaveFilePicker({
                suggestedName: filename,
                types: [{ description: 'TectoLite project', accept: { 'application/json': ['.json'] } }]
            });
            const writer = await handle.createWritable();
            try {
                await writer.write(json);
                await writer.close();
            } catch (error) {
                await writer.abort().catch(() => undefined);
                throw error;
            }
            return 'saved';
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
            throw error;
        }
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    // Anchor downloads provide no completion signal. Never claim durable saving.
    return 'download-started';
}

export async function runProjectSave(callbacks: {
    save: () => Promise<ProjectSaveResult>;
    saved: () => void;
    notify: (message: string) => void;
}): Promise<void> {
    try {
        const result = await callbacks.save();
        if (result === 'saved') {
            callbacks.saved();
            callbacks.notify('Project saved');
        } else if (result === 'download-started') {
            callbacks.notify('Download started. Recovery is kept until a save is confirmed.');
        }
    } catch (error) {
        callbacks.notify(`Save failed: ${error instanceof Error ? error.message : 'Could not write the project'}. Recovery is kept.`);
    }
}
