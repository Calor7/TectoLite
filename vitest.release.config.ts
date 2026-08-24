import { defineConfig } from 'vitest/config';

export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify('test')
    },
    test: {
        // .agent contains its own utility test harness, not TectoLite tests.
        exclude: ['**/.agent/**', '**/node_modules/**', '**/dist/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'text-summary'],
            reportsDirectory: 'coverage',
            thresholds: {
                // Current measured baseline. Keep CI from regressing while
                // allowing coverage to be raised incrementally from here.
                statements: 47,
                branches: 45,
                functions: 53,
                lines: 48
            }
        }
    }
});
