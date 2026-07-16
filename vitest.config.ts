import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // .agent contains its own utility test harness, not TectoLite tests.
        exclude: ['**/.agent/**', '**/node_modules/**', '**/dist/**']
    }
});
