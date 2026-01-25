import { defineConfig } from 'vite';

export default defineConfig({
    base: './', // Use relative paths for assets so app works in any subdirectory
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
        sourcemap: false
    }
});
