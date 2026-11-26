import { defineConfig } from 'vite';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __GOOGLE_DESKTOP_SECRET__: JSON.stringify(process.env.GOOGLE_DESKTOP_SECRET || '') },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200, target: 'es2020' },
  server: { host: true },
});
