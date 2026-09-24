/** Keep new split/fuse names readable; stable IDs preserve identity. */
export function generatedOperationName(baseName: string, suffix: string): string {
    const limit = 64 - suffix.length;
    const base = baseName.length > limit ? baseName.slice(0, limit - 1).trimEnd() + '…' : baseName;
    return base + suffix;
}
