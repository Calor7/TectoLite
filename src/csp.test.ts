import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';

describe('renderer Content Security Policy', () => {
    it('blocks executable remote content while allowing local wasm and embedded raster images', () => {
        const policy = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';

        expect(policy).toContain("default-src 'self'");
        expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
        expect(policy).not.toContain("'unsafe-eval'");
        expect(policy).toContain("img-src 'self' data: blob:");
        expect(policy).toContain("object-src 'none'");
        expect(policy).toContain("base-uri 'self'");
        expect(policy).toContain("form-action 'none'");
    });
});
