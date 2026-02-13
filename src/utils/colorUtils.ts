/**
 * Mix two hex colors together.
 * @param color1 Hex color string (e.g. "#ff0000")
 * @param color2 Hex color string (e.g. "#0000ff")
 * @param weight Weight of color1 (0-1). Default 0.5 for even mix.
 * @returns Mixed hex color string
 */
export function mixColors(color1: string, color2: string, weight: number = 0.5): string {
    // Helper to parse hex
    const parse = (hex: string) => {
        const clean = hex.replace('#', '');
        if (clean.length === 3) {
            return [
                parseInt(clean[0] + clean[0], 16),
                parseInt(clean[1] + clean[1], 16),
                parseInt(clean[2] + clean[2], 16)
            ];
        }
        return [
            parseInt(clean.slice(0, 2), 16),
            parseInt(clean.slice(2, 4), 16),
            parseInt(clean.slice(4, 6), 16)
        ];
    };

    const rgb1 = parse(color1);
    const rgb2 = parse(color2);

    const mix = (c1: number, c2: number) => Math.round(c1 * weight + c2 * (1 - weight));

    const r = mix(rgb1[0], rgb2[0]);
    const g = mix(rgb1[1], rgb2[1]);
    const b = mix(rgb1[2], rgb2[2]);

    const toHex = (n: number) => {
        const hex = Math.max(0, Math.min(255, n)).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
