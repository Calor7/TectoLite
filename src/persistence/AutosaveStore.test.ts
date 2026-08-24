import { describe, expect, it } from 'vitest';
import {
    AutosaveStore,
    LEGACY_AUTOSAVE_KEY,
    type AutosaveBackend,
    type LegacyAutosaveStorage,
} from './AutosaveStore';

class MemoryBackend implements AutosaveBackend {
    public readonly kind = 'electron-file' as const;
    public value: string | null = null;
    public failWrites = false;
    public async read(): Promise<string | null> { return this.value; }
    public async write(value: string): Promise<void> {
        if (this.failWrites) throw new Error('write failed');
        this.value = value;
    }
    public async clear(): Promise<void> { this.value = null; }
}

class MemoryLegacyStorage implements LegacyAutosaveStorage {
    private readonly values = new Map<string, string>();
    public getItem(key: string): string | null { return this.values.get(key) ?? null; }
    public setItem(key: string, value: string): void { this.values.set(key, value); }
    public removeItem(key: string): void { this.values.delete(key); }
}

describe('AutosaveStore', () => {
    it('writes, reads, and clears through the primary durable backend', async () => {
        const backend = new MemoryBackend();
        const store = new AutosaveStore(backend);

        await store.write('{"version":10}');
        expect(await store.read()).toBe('{"version":10}');
        await store.clear();
        expect(await store.read()).toBeNull();
    });

    it('migrates a legacy localStorage autosave only after a successful durable write', async () => {
        const backend = new MemoryBackend();
        const legacy = new MemoryLegacyStorage();
        legacy.setItem(LEGACY_AUTOSAVE_KEY, 'legacy-save');
        const store = new AutosaveStore(backend, legacy);

        expect(await store.read()).toBe('legacy-save');
        expect(backend.value).toBe('legacy-save');
        expect(legacy.getItem(LEGACY_AUTOSAVE_KEY)).toBeNull();
    });

    it('keeps legacy recovery data if migration to durable storage fails', async () => {
        const backend = new MemoryBackend();
        backend.failWrites = true;
        const legacy = new MemoryLegacyStorage();
        legacy.setItem(LEGACY_AUTOSAVE_KEY, 'recover-me');
        const store = new AutosaveStore(backend, legacy);

        await expect(store.read()).rejects.toThrow('write failed');
        expect(legacy.getItem(LEGACY_AUTOSAVE_KEY)).toBe('recover-me');
    });
});
