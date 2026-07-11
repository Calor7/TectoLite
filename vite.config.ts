import { readFileSync } from 'fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
    base: './', // Use relative paths for assets so app works in any subdirectory
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version)
    },
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
        sourcemap: false
    }
});
