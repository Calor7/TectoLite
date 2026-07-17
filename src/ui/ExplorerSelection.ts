/** Return the inclusive visible range between the Explorer anchor and target. */
export function selectExplorerRange(orderedIds: readonly string[], anchorId: string | null, targetId: string): string[] {
    const anchorIndex = anchorId ? orderedIds.indexOf(anchorId) : -1;
    const targetIndex = orderedIds.indexOf(targetId);
    if (anchorIndex < 0 || targetIndex < 0) return [targetId];

    return orderedIds.slice(
        Math.min(anchorIndex, targetIndex),
        Math.max(anchorIndex, targetIndex) + 1
    );
}
