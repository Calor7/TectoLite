import { readFileSync } from 'fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
    base: './', // Use relative paths for assets so app works in any subdirectory
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version)
    },
    server: {
        // Generated saves and Windows packages can be huge or temporarily locked.
        // They are not source files and must not trigger reloads or watcher crashes.
        watch: { ignored: ['**/output/**', '**/release/**'] }
    },
    optimizeDeps: {
        // The default HTML crawl also traverses packaged Chromium licenses.
        entries: ['index.html']
    },
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
        sourcemap: false
    }
});
