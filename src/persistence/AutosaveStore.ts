export const LEGACY_AUTOSAVE_KEY = 'tectolite_autosave_v1';

export type AutosaveStorageKind = 'electron-file' | 'indexeddb' | 'localstorage-fallback';

export interface AutosaveBackend {
    readonly kind: AutosaveStorageKind;
    read(): Promise<string | null>;
    write(value: string): Promise<void>;
    clear(): Promise<void>;
}

export interface LegacyAutosaveStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface ElectronAutosaveBridge {
    readAutosave(): Promise<string | null>;
    writeAutosave(value: string): Promise<void>;
    clearAutosave(): Promise<void>;
}

/**
 * One small persistence interface for crash recovery. The primary adapter is
 * an atomic file in Electron and IndexedDB in the browser. localStorage is
 * read only as a legacy migration source unless neither durable adapter is
 * available.
 */
export class AutosaveStore {
    public readonly kind: AutosaveStorageKind;

    public constructor(
        private readonly primary: AutosaveBackend,
        private readonly legacy?: LegacyAutosaveStorage,
    ) {
        this.kind = primary.kind;
    }

    public async read(): Promise<string | null> {
        const stored = await this.primary.read();
        if (stored !== null) return stored;

        const legacyValue = this.legacy?.getItem(LEGACY_AUTOSAVE_KEY) ?? null;
        if (legacyValue === null) return null;

        // Migrate the old quota-limited autosave on first read. Only remove it
        // after the durable write succeeds, so a failed migration cannot lose
        // the user's recovery data.
        await this.primary.write(legacyValue);
        this.legacy?.removeItem(LEGACY_AUTOSAVE_KEY);
        return legacyValue;
    }

    public async write(value: string): Promise<void> {
        await this.primary.write(value);
        if (this.primary.kind !== 'localstorage-fallback') {
            this.legacy?.removeItem(LEGACY_AUTOSAVE_KEY);
        }
    }

    public async clear(): Promise<void> {
        await this.primary.clear();
        this.legacy?.removeItem(LEGACY_AUTOSAVE_KEY);
    }
}

class ElectronAutosaveBackend implements AutosaveBackend {
    public readonly kind = 'electron-file' as const;
    public constructor(private readonly bridge: ElectronAutosaveBridge) { }
    public read(): Promise<string | null> { return this.bridge.readAutosave(); }
    public write(value: string): Promise<void> { return this.bridge.writeAutosave(value); }
    public clear(): Promise<void> { return this.bridge.clearAutosave(); }
}

class LocalStorageAutosaveBackend implements AutosaveBackend {
    public readonly kind = 'localstorage-fallback' as const;
    public constructor(private readonly storage: LegacyAutosaveStorage) { }
    public async read(): Promise<string | null> { return this.storage.getItem(LEGACY_AUTOSAVE_KEY); }
    public async write(value: string): Promise<void> { this.storage.setItem(LEGACY_AUTOSAVE_KEY, value); }
    public async clear(): Promise<void> { this.storage.removeItem(LEGACY_AUTOSAVE_KEY); }
}

class IndexedDbAutosaveBackend implements AutosaveBackend {
    public readonly kind = 'indexeddb' as const;
    private static readonly DB_NAME = 'tectolite-project-recovery';
    private static readonly STORE_NAME = 'autosaves';
    private static readonly ACTIVE_KEY = 'active-project';

    public constructor(private readonly indexedDb: IDBFactory) { }

    private open(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = this.indexedDb.open(IndexedDbAutosaveBackend.DB_NAME, 1);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(IndexedDbAutosaveBackend.STORE_NAME)) {
                    request.result.createObjectStore(IndexedDbAutosaveBackend.STORE_NAME);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('Could not open autosave database'));
            request.onblocked = () => reject(new Error('Autosave database upgrade was blocked'));
        });
    }

    private async request<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
        const database = await this.open();
        try {
            return await new Promise<T>((resolve, reject) => {
                const transaction = database.transaction(IndexedDbAutosaveBackend.STORE_NAME, mode);
                const request = operation(transaction.objectStore(IndexedDbAutosaveBackend.STORE_NAME));
                let result: T;
                request.onsuccess = () => { result = request.result; };
                request.onerror = () => reject(request.error ?? new Error('Autosave database operation failed'));
                transaction.oncomplete = () => resolve(result);
                transaction.onerror = () => reject(transaction.error ?? new Error('Autosave database transaction failed'));
                transaction.onabort = () => reject(transaction.error ?? new Error('Autosave database transaction aborted'));
            });
        } finally {
            database.close();
        }
    }

    public async read(): Promise<string | null> {
        const value = await this.request<unknown>('readonly', store => store.get(IndexedDbAutosaveBackend.ACTIVE_KEY));
        return typeof value === 'string' ? value : null;
    }

    public async write(value: string): Promise<void> {
        await this.request<IDBValidKey>('readwrite', store => store.put(value, IndexedDbAutosaveBackend.ACTIVE_KEY));
    }

    public async clear(): Promise<void> {
        await this.request<undefined>('readwrite', store => store.delete(IndexedDbAutosaveBackend.ACTIVE_KEY));
    }
}

export interface AutosaveEnvironment {
    electron?: ElectronAutosaveBridge;
    indexedDB?: IDBFactory;
    localStorage?: LegacyAutosaveStorage;
}

export function createAutosaveStore(environment: AutosaveEnvironment = window as unknown as AutosaveEnvironment): AutosaveStore {
    const legacy = environment.localStorage;
    if (environment.electron) {
        return new AutosaveStore(new ElectronAutosaveBackend(environment.electron), legacy);
    }
    if (environment.indexedDB) {
        return new AutosaveStore(new IndexedDbAutosaveBackend(environment.indexedDB), legacy);
    }
    if (!legacy) throw new Error('No autosave storage is available');
    return new AutosaveStore(new LocalStorageAutosaveBackend(legacy));
}
