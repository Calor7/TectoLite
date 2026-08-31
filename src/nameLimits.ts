/** Maximum length accepted for names in saved project files. */
export const MAX_PROJECT_NAME_LENGTH = 200;

/**
 * Keeps automatic operation names within the save-file limit while retaining
 * their distinguishing suffix (for example, " (A)" or " (Fused)").
 */
export function generatedNameWithSuffix(baseName: string, suffix: string): string {
    return `${baseName.slice(0, MAX_PROJECT_NAME_LENGTH - suffix.length)}${suffix}`;
}

/** Repairs the automatic names produced by older versions before validation. */
export function repairGeneratedProjectName(name: string): string {
    const suffix = name.match(/ \((?:A|B|Fused)\)$/)?.[0];
    return suffix && name.length > MAX_PROJECT_NAME_LENGTH
        ? generatedNameWithSuffix(name.slice(0, -suffix.length), suffix)
        : name;
}
